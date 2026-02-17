class SmartFridgeApp {
    constructor() {
        this.items = [];
        this.history = [];
        this.sheetsAPI = window.googleSheetsAPI;
        this.localDB = window.LocalDatabase ? new window.LocalDatabase() : null;
        this.hybridDB = window.HybridDatabase ? new window.HybridDatabase() : null;
        this.databaseMode = localStorage.getItem('databaseMode') || 'local';
        this.scanMode = 'in'; // 'in' (新增/進貨) 或 'out' (移除/出貨)
        this.currentModalItem = null; // 當前正在編輯的物品
        this.socket = null;
        this.init();
    }

    async init() {
        this.bindEvents();
        this.initSocket();
        this.initScanner(); // [新增] 初始化掃描功能
        this.renderTabs();
        
        // 資料庫初始化
        if (this.databaseMode === 'local') {
            await this.localDB.init();
            this.items = await this.localDB.getAllItems();
        } else {
            await this.hybridDB.init();
            this.items = await this.hybridDB.getAllItems();
        }
        
        this.renderInventory();
        this.updateStats();
    }

    initSocket() {
        // 自動判斷 Socket.IO 連線位置
        const SERVER_URL = window.location.origin;
        this.socket = io(SERVER_URL);

        this.socket.on('connect', () => {
            this.updateStatus('server', true);
            this.showNotification('已連線到智慧冰箱系統');
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('server', false);
            this.updateStatus('camera', false);
        });

        this.socket.on('detector_status', (online) => {
            this.updateStatus('camera', online);
            if (online) {
                this.showNotification('AI 鏡頭已連線');
                // 鏡頭重連時自動同步
                this.socket.emit('smart_reset', []);
            }
        });

        this.socket.on('init_data', (data) => {
            if (data.inventory) this.handleServerUpdate(data.inventory);
            if (data.history) {
                this.history = data.history;
                this.renderHistory();
            }
            this.updateStatus('camera', data.isDetectorConnected);
        });

        this.socket.on('update_data', (inventory) => {
            this.handleServerUpdate(inventory);
            this.playSound('update');
        });

        this.socket.on('update_history', (history) => {
            this.history = history;
            this.renderHistory();
        });
    }

    // [新增] 初始化掃描功能
    initScanner() {
        // 切換掃描模式
        document.getElementById('scanInBtn').addEventListener('click', () => this.setScanMode('in'));
        document.getElementById('scanOutBtn').addEventListener('click', () => this.setScanMode('out'));

        // 全域掃描監聽
        const globalScanner = document.getElementById('globalScanner');
        globalScanner.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const code = globalScanner.value.trim();
                if (code) {
                    this.handleGlobalScan(code);
                    globalScanner.value = ''; // 清空
                }
            }
        });

        // 監聽全頁面鍵盤輸入（如果沒有 focus 在其他 input 上）
        document.addEventListener('keypress', (e) => {
            // 如果 Modal 打開了，不攔截（交給 Modal 內的邏輯）
            if (document.getElementById('itemModal').classList.contains('open')) return;
            
            // 如果已經 focus 在某個 input 上，不攔截
            if (document.activeElement.tagName === 'INPUT') return;

            // 否則自動 focus 到全域掃描框
            globalScanner.focus();
        });
    }

    setScanMode(mode) {
        this.scanMode = mode;
        const inBtn = document.getElementById('scanInBtn');
        const outBtn = document.getElementById('scanOutBtn');
        
        if (mode === 'in') {
            inBtn.classList.add('active', 'in');
            outBtn.classList.remove('active', 'out');
        } else {
            inBtn.classList.remove('active', 'in');
            outBtn.classList.add('active', 'out');
        }
        
        // 切換後自動 focus
        document.getElementById('globalScanner').focus();
    }

    // [新增] 處理全域掃描
    async handleGlobalScan(code) {
        console.log(`掃描條碼: ${code}, 模式: ${this.scanMode}`);
        
        // 1. 嘗試尋找是否已有此條碼的物品
        let targetItem = this.items.find(i => i.barcode === code);
        
        // 如果找不到條碼，嘗試找名稱 (有些條碼可能直接是名稱)
        if (!targetItem) {
            targetItem = this.items.find(i => i.name === code);
        }

        if (this.scanMode === 'in') {
            // 進貨模式
            if (targetItem) {
                // 已有物品 -> 數量 +1
                this.updateQty(targetItem.name, 1);
                this.showNotification(`已增加: ${targetItem.name}`);
            } else {
                // 新物品 -> 建立未知物品
                const newItemName = `物品-${code}`;
                this.items.push({
                    name: newItemName,
                    quantity: 1,
                    barcode: code, // 記錄條碼
                    source: '掃描新增',
                    id: Date.now()
                });
                this.syncUpdate();
                this.renderInventory();
                this.showNotification(`已新增未知物品: ${code}`);
                
                // 自動彈出 Modal 讓使用者編輯
                setTimeout(() => this.openModal(newItemName), 500);
            }
        } else {
            // 出貨模式
            if (targetItem) {
                this.updateQty(targetItem.name, -1);
                this.showNotification(`已取出: ${targetItem.name}`);
            } else {
                this.showNotification(`找不到條碼為 ${code} 的物品`, 'error');
            }
        }
    }

    // [新增] 打開物品詳情 Modal
    openModal(itemName) {
        const item = this.items.find(i => i.name === itemName);
        if (!item) return;

        this.currentModalItem = item;
        
        document.getElementById('modalTitle').textContent = '物品詳情';
        document.getElementById('modalItemName').textContent = item.name;
        document.getElementById('modalQtyDisplay').textContent = item.quantity;
        document.getElementById('modalExpDate').value = item.expirationDate || '';
        
        // 顯示已綁定的條碼
        const linkedDiv = document.getElementById('linkedBarcodes');
        if (item.barcode) {
            linkedDiv.innerHTML = `已綁定條碼: <strong>${item.barcode}</strong>`;
        } else {
            linkedDiv.innerHTML = '尚未綁定條碼';
        }

        // 綁定 Modal 內的按鈕
        document.getElementById('modalIncreaseBtn').onclick = () => this.updateQty(item.name, 1);
        document.getElementById('modalDecreaseBtn').onclick = () => this.updateQty(item.name, -1);
        document.getElementById('modalExpDate').onchange = (e) => this.updateExp(item.name, e.target.value);

        // 綁定 Modal 內的掃描框
        const scannerInput = document.getElementById('modalBarcodeScanner');
        scannerInput.value = '';
        scannerInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                const code = scannerInput.value.trim();
                if (code) {
                    this.linkBarcodeToItem(item, code);
                    scannerInput.value = '';
                }
            }
        };

        document.getElementById('itemModal').classList.add('open');
    }

    closeModal() {
        document.getElementById('itemModal').classList.remove('open');
        this.currentModalItem = null;
        document.getElementById('globalScanner').focus(); // 關閉後 focus 回全域掃描
    }

    // [新增] 將條碼綁定到物品
    linkBarcodeToItem(item, code) {
        // 檢查條碼是否已被其他物品使用
        const conflict = this.items.find(i => i.barcode === code && i.name !== item.name);
        if (conflict) {
            if(!confirm(`條碼 ${code} 已被 "${conflict.name}" 使用。確定要轉移到 "${item.name}" 嗎？`)) {
                return;
            }
            conflict.barcode = null; // 移除舊綁定
        }

        item.barcode = code;
        this.syncUpdate(); // 同步到 Server
        
        // 更新 UI
        document.getElementById('linkedBarcodes').innerHTML = `已綁定條碼: <strong>${code}</strong>`;
        this.showNotification(`成功綁定條碼: ${code}`);
    }

    handleServerUpdate(serverInventory) {
        // 合併邏輯：保留本地的有效期限、條碼等額外資訊
        const newItems = serverInventory.map(sItem => {
            const localItem = this.items.find(l => l.name === sItem.name);
            return {
                ...sItem,
                expirationDate: localItem ? localItem.expirationDate : '',
                barcode: localItem ? localItem.barcode : null, // 保留條碼
                code: sItem.name 
            };
        });
        
        this.items = newItems;
        this.renderInventory();
        
        // 如果 Modal 開著，即時更新 Modal 數據
        if (this.currentModalItem) {
            const updatedItem = this.items.find(i => i.name === this.currentModalItem.name);
            if (updatedItem) {
                document.getElementById('modalQtyDisplay').textContent = updatedItem.quantity;
            }
        }

        this.updateStats();
    }

    renderInventory() {
        const grid = document.getElementById('itemList');
        const filter = document.getElementById('searchInput').value.toLowerCase();
        
        const filteredItems = this.items.filter(item => 
            item.name.toLowerCase().includes(filter)
        );

        if (filteredItems.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <p>${filter ? '找不到符合的物品' : '冰箱目前空空如也'}</p>
                </div>`;
            return;
        }

        grid.innerHTML = filteredItems.map(item => {
            const isDetecting = item.isDetecting;
            const expDate = item.expirationDate || '';
            // 簡單判斷過期
            let expClass = '';
            if (expDate) {
                const daysLeft = (new Date(expDate) - new Date()) / (1000 * 60 * 60 * 24);
                if (daysLeft < 0) expClass = 'expired';
                else if (daysLeft < 3) expClass = 'expiring';
            }

            return `
            <div class="item-card ${isDetecting ? 'detecting' : ''}" onclick="app.openModal('${item.name}')">
                <div class="item-header">
                    <div class="item-icon">📦</div>
                    ${isDetecting ? '<span class="item-badge detecting">AI 偵測中</span>' : ''}
                </div>
                <div class="item-details">
                    <h3>${item.name}</h3>
                    <div class="item-meta">
                        來源: ${item.source || '手動'}
                        ${item.barcode ? `<br>條碼: ${item.barcode}` : ''}
                    </div>
                    
                    <div class="item-controls" onclick="event.stopPropagation()">
                        <button class="qty-btn" onclick="app.updateQty('${item.name}', -1)">-</button>
                        <span class="qty-display">${item.quantity}</span>
                        <button class="qty-btn" onclick="app.updateQty('${item.name}', 1)">+</button>
                    </div>

                    <input type="date" class="expiration-input ${expClass}" 
                           value="${expDate}" 
                           onchange="app.updateExp('${item.name}', this.value)"
                           onclick="event.stopPropagation()"
                           title="有效期限">
                </div>
            </div>
            `;
        }).join('');
    }

    renderHistory() {
        const list = document.getElementById('historyList');
        list.innerHTML = this.history.map(log => {
            const date = new Date(log.time);
            const timeStr = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            return `
            <div class="history-item">
                <div class="history-time">${timeStr}</div>
                <div class="history-content">
                    <span class="history-tag tag-${log.action}">${this.getActionLabel(log.action)}</span>
                    <strong>${log.item}</strong> 
                    ${log.quantity ? `數量: ${log.quantity}` : ''}
                    <span style="color:#999; font-size:0.85em; margin-left:10px">${log.details}</span>
                </div>
            </div>
            `;
        }).join('');
    }

    getActionLabel(action) {
        const map = {
            'DETECT': 'AI 偵測',
            'MANUAL': '手動操作',
            'RESET': '系統重置',
            'CLEAN': '庫存清理'
        };
        return map[action] || action;
    }

    updateQty(name, change) {
        const item = this.items.find(i => i.name === name);
        if (item) {
            const newQty = Math.max(0, parseInt(item.quantity) + change);
            item.quantity = newQty;
            if (newQty === 0) {
                this.items = this.items.filter(i => i.name !== name);
            }
            this.syncUpdate();
            this.renderInventory();
            this.updateStats();
        }
    }

    updateExp(name, date) {
        const item = this.items.find(i => i.name === name);
        if (item) {
            item.expirationDate = date;
            // 這裡只更新本地狀態，理想情況下應該也要同步到 Server
            // 但因為 Server 目前只存 name/qty，我們暫時存在本地 items 陣列中
            // 如果要持久化，需要修改 Server 結構，這裡先做前端暫存
            this.renderInventory();
            this.updateStats();
        }
    }

    syncUpdate() {
        // 過濾掉數量為 0 的項目
        const cleanInventory = this.items.filter(i => i.quantity > 0);
        this.socket.emit('manual_update', cleanInventory);
    }

    manualAdd() {
        const nameInput = document.getElementById('manualName');
        const qtyInput = document.getElementById('manualQty');
        const name = nameInput.value.trim();
        const qty = parseInt(qtyInput.value);

        if (name && qty > 0) {
            const existing = this.items.find(i => i.name === name);
            if (existing) {
                existing.quantity += qty;
            } else {
                this.items.push({
                    name: name,
                    quantity: qty,
                    source: '手動新增',
                    id: Date.now()
                });
            }
            this.syncUpdate();
            nameInput.value = '';
            qtyInput.value = 1;
            this.showNotification(`已新增 ${name}`);
        }
    }

    smartReset() {
        if(confirm('確定要執行智慧重置嗎？\n這將清空當前列表並重新從鏡頭獲取數據。')) {
            this.socket.emit('smart_reset', []);
        }
    }

    clearZero() {
        this.socket.emit('clean_zero');
    }

    clearHistory() {
        this.history = [];
        this.renderHistory();
        // 實際應用可能需要通知 Server 清空
    }

    updateStats() {
        const totalItems = this.items.length;
        const totalQty = this.items.reduce((acc, cur) => acc + (parseInt(cur.quantity) || 0), 0);
        
        document.getElementById('totalItems').textContent = totalItems;
        document.getElementById('totalQuantity').textContent = totalQty;
        
        // 計算即將過期
        const expiring = this.items.filter(i => {
            if (!i.expirationDate) return false;
            const days = (new Date(i.expirationDate) - new Date()) / (1000 * 60 * 60 * 24);
            return days < 3;
        }).length;
        document.getElementById('expiringItems').textContent = expiring;
    }

    updateStatus(type, online) {
        const el = document.getElementById(type === 'server' ? 'serverStatus' : 'cameraStatus');
        if (el) {
            el.className = `status-dot ${online ? 'online' : 'offline'}`;
        }
    }

    renderTabs() {
        const tabs = document.querySelectorAll('.nav-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class
                document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                // Add active
                tab.classList.add('active');
                const contentId = `tab-${tab.dataset.tab}`;
                document.getElementById(contentId).classList.add('active');
            });
        });
    }

    bindEvents() {
        document.getElementById('searchInput').addEventListener('input', () => this.renderInventory());
        document.getElementById('smartResetBtn').addEventListener('click', () => this.smartReset());
        document.getElementById('cleanZeroBtn').addEventListener('click', () => this.clearZero());
        document.getElementById('manualAddBtn').addEventListener('click', () => this.manualAdd());
    }

    showNotification(msg) {
        const el = document.getElementById('notification');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }

    playSound(type) {
        // 簡單的音效生成，不需要外部文件
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        if (type === 'update') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        }
    }
}

// 啟動應用
window.app = new SmartFridgeApp();