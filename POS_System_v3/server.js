const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const ip = require('ip');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允許所有來源連線
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'inventory.json');
const HISTORY_FILE = path.join(__dirname, 'history.json'); // [新增] 歷史紀錄檔案
const DUPLICATE_THRESHOLD = 3000;

let inventory = [];
let history = []; // [新增] 歷史紀錄陣列
let isDetectorConnected = false;

// 讀取存檔
if (fs.existsSync(DATA_FILE)) {
    try {
        inventory = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        console.log(`[系統] 已載入 ${inventory.length} 筆庫存資料`);
    } catch (e) {
        inventory = [];
    }
}

// [新增] 讀取歷史紀錄
if (fs.existsSync(HISTORY_FILE)) {
    try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        console.log(`[系統] 已載入 ${history.length} 筆歷史紀錄`);
    } catch (e) {
        history = [];
    }
}

function saveInventory() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inventory, null, 2));
}

// [新增] 儲存歷史紀錄
function saveHistory() {
    // 只保留最近 100 筆
    if (history.length > 100) {
        history = history.slice(0, 100);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// [新增] 添加歷史紀錄
function addHistory(action, itemName, quantity, details = '') {
    const log = {
        id: Date.now(),
        time: new Date().toISOString(),
        action: action, // 'IN', 'OUT', 'UPDATE', 'DETECT'
        item: itemName,
        quantity: quantity,
        details: details
    };
    history.unshift(log); // 加到最前面
    saveHistory();
    io.emit('update_history', history);
}

io.on('connection', (socket) => {
    // 發送初始狀態
    socket.emit('init_data', { 
        inventory, 
        history, // [新增] 發送歷史紀錄
        isDetectorConnected 
    });

    // --- [新增] 識別偵測端 ---
    // PC.py 連線後會發送這個事件
    socket.on('register_detector', () => {
        isDetectorConnected = true;
        console.log('[系統] 偵測端 (PC.py) 已連線');
        io.emit('detector_status', true); // 廣播給所有 Receiver
        
        // 偵測端斷線處理
        socket.on('disconnect', () => {
            isDetectorConnected = false;
            console.log('[系統] 偵測端已斷線');
            io.emit('detector_status', false);
        });
    });

    socket.on('detect_item', (data) => {
        // [除錯 Log]
        // console.log(`[DEBUG] 收到訊號:`, data);
        
        const { name, quantity, isAutoMode, action } = data;
        const now = Date.now();
        
        if (!name) return;
        const qty = parseInt(quantity) || 1;
        
        let item = inventory.find(i => i.name === name);
        let actionType = '';

        if (action === 'REMOVE') {
            if (item) {
                item.quantity -= qty;
                if (item.quantity <= 0) item.quantity = 0;
                item.lastUpdated = now;
                actionType = 'REMOVE';
                console.log(`[DEBUG] 移除: ${name}, 剩: ${item.quantity}`);
            }
        } else if (item) {
            const timeDiff = now - (item.lastUpdated || 0);

            if (isAutoMode && timeDiff < DUPLICATE_THRESHOLD) {
                const lastQty = item.lastDetectedQty || 0;
                if (qty !== lastQty) {
                    item.quantity += (qty - lastQty);
                    item.lastDetectedQty = qty;
                    actionType = 'CORRECT';
                    if(item.quantity < 0) item.quantity = 0;
                } else {
                    actionType = 'DUPLICATE';
                }
                item.lastUpdated = now;
                item.isDetecting = true;
            } else {
                item.quantity += qty;
                item.lastUpdated = now;
                item.isDetecting = isAutoMode;
                item.lastDetectedQty = qty;
                actionType = 'ADD';
                addHistory('DETECT', name, qty, 'AI 偵測新增'); // [新增] 紀錄
            }
        } else {
            if (action !== 'REMOVE') {
                item = {
                    id: Date.now(),
                    name: name,
                    quantity: qty,
                    source: 'A端偵測',
                    lastUpdated: now,
                    isDetecting: isAutoMode,
                    lastDetectedQty: qty,
                    expirationDate: '' // [新增] 有效期限欄位
                };
                inventory.push(item);
                actionType = 'NEW';
                addHistory('DETECT', name, qty, 'AI 偵測發現新物品'); // [新增] 紀錄
            }
        }

        saveInventory();
        io.emit('update_data', inventory);
        socket.emit('log_response', { name, action: actionType });
    });

    socket.on('manual_update', (newInventory) => {
        // 簡單比對變化以記錄 Log (這裡只做簡單長度比對，細節可優化)
        if (newInventory.length > inventory.length) {
             addHistory('MANUAL', '未知', 1, '手動新增物品');
        } else if (newInventory.length < inventory.length) {
             addHistory('MANUAL', '未知', 1, '手動移除物品');
        }
        
        inventory = newInventory;
        saveInventory();
        io.emit('update_data', inventory);
    });

    // --- [新增] 清除數量為 0 的物品 ---
    socket.on('clean_zero', () => {
        const initialCount = inventory.length;
        inventory = inventory.filter(item => item.quantity > 0);
        const removedCount = initialCount - inventory.length;
        
        if (removedCount > 0) {
            addHistory('CLEAN', '批量操作', removedCount, '清除零庫存項目');
        }

        saveInventory();
        io.emit('update_data', inventory);
        console.log(`[系統] 已清除 ${removedCount} 筆零庫存項目`);
    });

    // --- [修改] 智慧歸零 ---
    socket.on('smart_reset', (currentActiveItems) => {
        addHistory('RESET', '系統', 0, '執行智慧重置');
        // currentActiveItems: 來自 PC.py 的目前畫面物品清單 (如果有的話)
        
        if (isDetectorConnected && Array.isArray(currentActiveItems)) {
            // 情況 1: 偵測端連線中 -> 重置為「目前畫面上的狀態」
            console.log('[系統] 執行智慧歸零 (保留畫面物品)');
            
            // 建立新的庫存列表，只包含目前畫面上的
            // 這裡邏輯：我們信任 PC.py 傳來的 currentActiveItems 是「完整的畫面快照」
            // 但 PC.py 其實沒有傳送 "完整快照"，它只是一直傳 "單一事件"。
            
            // 修正策略：
            // 如果要實現 "依據即時影像歸零"，代表我們要相信 "現在畫面上沒看到的，就是不存在"。
            // 但 PC.py 的事件流是 "偵測到才發送"。
            
            // 所以這裡最簡單的作法是：直接清空。
            // 因為 PC.py 有 "persist=True" (追蹤)，當我們清空 Server 庫存後，
            // 畫面上的物體如果還在，PC.py 下一幀就會繼續偵測到它們嗎？
            // 不會，因為 PC.py 認為它們已經 "Sent" (狀態是 done)。
            
            // [關鍵] 我們需要通知 PC.py "重置你的狀態，把所有東西當作新東西再送一次"。
            io.emit('request_resync'); // 通知 PC.py 重送
            inventory = []; // 先清空 Server
            
        } else {
            // 情況 2: 沒連線 -> 全部清空
            console.log('[系統] 執行強制清空');
            inventory = [];
        }
        
        saveInventory();
        io.emit('update_data', inventory);
    });
});

setInterval(() => {
    const now = Date.now();
    let changed = false;
    inventory.forEach(item => {
        if (item.isDetecting && (now - item.lastUpdated > DUPLICATE_THRESHOLD)) {
            item.isDetecting = false;
            item.lastDetectedQty = 0;
            changed = true;
        }
    });
    if (changed) {
        io.emit('update_data', inventory);
    }
}, 500);

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('====================================================');
    console.log(` 伺服器已啟動！`);
    console.log(` 請在其他裝置的瀏覽器輸入以下網址來開啟程式：`);
    console.log(` -> http://${ip.address()}:${PORT}/`);
    console.log('====================================================');
});