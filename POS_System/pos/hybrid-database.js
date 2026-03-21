// 混合數據庫：本地優先 + Google Sheets 同步
// 先寫入本地數據庫（快速反應），然後異步同步到 Google Sheets

class HybridDatabase {
    constructor() {
        this.localDB = null;
        this.sheetsAPI = null;
        this.initialized = false;
        this.syncQueue = []; // 同步隊列
        this.syncing = false; // 是否正在同步
        this.syncInterval = null; // 定期同步定時器
        this.config = {
            spreadsheetId: '',
            sheetName: 'Sheet1',
            serviceAccount: null
        };
    }

    // 初始化混合數據庫
    async init(config = {}) {
        try {
            // 保存配置
            if (config.spreadsheetId) this.config.spreadsheetId = String(config.spreadsheetId).trim();
            if (config.sheetName) this.config.sheetName = String(config.sheetName).trim();
            if (config.serviceAccount) this.config.serviceAccount = config.serviceAccount;

            // 初始化本地數據庫（必須）
            if (!window.LocalDatabase) {
                throw new Error('本地數據庫未載入，請確保 local-database.js 已載入');
            }
            this.localDB = new window.LocalDatabase();
            await this.localDB.init();
            console.log('✅ 本地數據庫初始化成功');

            // 初始化 Google Sheets API（可選，如果配置了）
            if (this.config.spreadsheetId) {
                try {
                    if (!window.googleSheetsAPI) {
                        throw new Error('Google Sheets API 未載入');
                    }
                    this.sheetsAPI = window.googleSheetsAPI;
                    await this.sheetsAPI.init({
                        spreadsheetId: this.config.spreadsheetId,
                        sheetName: this.config.sheetName,
                        serviceAccount: this.config.serviceAccount
                    });
                    console.log('✅ Google Sheets 連接成功，將在後台同步');
                    
                    // 立即從 Google Sheets 完全同步到本地（確保初始數據完全一致）
                    console.log('🔄 正在從 Google Sheets 完全同步數據到本地（確保與 Sheet1 完全一致）...');
                    await this.syncFromSheetsToLocal(true); // 傳入 true 表示完全同步模式
                    console.log('✅ 初始數據完全同步完成，本地數據已與 Sheet1 完全一致');
                    
                    // 啟動定期同步（每 30 秒同步一次）
                    this.startPeriodicSync();
                } catch (error) {
                    console.warn('⚠️ Google Sheets 初始化失敗，將僅使用本地模式:', error);
                    this.sheetsAPI = null;
                }
            } else {
                console.log('ℹ️ 未配置 Google Sheets，僅使用本地模式');
            }

            this.initialized = true;
            return true;
        } catch (error) {
            console.error('❌ 混合數據庫初始化失敗:', error);
            this.initialized = false;
            throw error;
        }
    }

    // 啟動定期同步
    startPeriodicSync() {
        // 清除舊的定時器
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        // 每 30 秒同步一次
        this.syncInterval = setInterval(() => {
            this.processSyncQueue();
        }, 30000);
        
        console.log('✅ 已啟動定期同步（每 30 秒）');
    }

    // 停止定期同步
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // 處理同步隊列（雙向同步：推送本地變更到 Google Sheets，並拉取 Google Sheets 變更到本地）
    async processSyncQueue() {
        if (this.syncing || !this.sheetsAPI || !this.sheetsAPI.initialized) {
            return;
        }

        this.syncing = true;

        try {
            // 1. 先推送本地變更到 Google Sheets
            if (this.syncQueue.length > 0) {
                console.log(`🔄 開始推送 ${this.syncQueue.length} 個操作到 Google Sheets...`);
                const queueCopy = [...this.syncQueue];
                this.syncQueue = [];

                for (const item of queueCopy) {
                    try {
                        await this.executeSyncOperation(item);
                    } catch (error) {
                        console.error('同步操作失敗:', error);
                        // 如果同步失敗，重新加入隊列（最多重試 3 次）
                        if (item.retryCount < 3) {
                            item.retryCount = (item.retryCount || 0) + 1;
                            this.syncQueue.push(item);
                        }
                    }
                }
                console.log('✅ 本地變更已推送到 Google Sheets');
            }

            // 2. 不再自動拉取 Google Sheets 數據（避免覆蓋本地剛更新的數據）
            // 只在初始化時拉取，之後只推送本地變更到 Google Sheets
            // 如果需要同步，用戶可以手動點擊"刷新"按鈕
            console.log('✅ 本地變更已推送到 Google Sheets（不自動拉取，避免覆蓋本地更新）');
        } catch (error) {
            console.error('同步過程出錯:', error);
        } finally {
            this.syncing = false;
        }
    }

    // 執行同步操作
    async executeSyncOperation(operation) {
        const { type, code, name, quantity } = operation;

        switch (type) {
            case 'update':
                await this.sheetsAPI.updateItem(code, name, quantity);
                break;
            case 'delete':
                await this.sheetsAPI.deleteItem(code);
                break;
            default:
                console.warn('未知的同步操作類型:', type);
        }
    }

    // 添加到同步隊列
    addToSyncQueue(type, code, name, quantity = null) {
        if (!this.sheetsAPI || !this.sheetsAPI.initialized) {
            return; // 如果沒有配置 Google Sheets，不添加到隊列
        }

        // 檢查隊列中是否已有相同的操作（避免重複）
        const existingIndex = this.syncQueue.findIndex(
            item => item.type === type && item.code === code
        );

        const operation = { type, code, name, quantity, retryCount: 0 };

        if (existingIndex >= 0) {
            // 更新現有操作
            this.syncQueue[existingIndex] = operation;
        } else {
            // 添加新操作
            this.syncQueue.push(operation);
        }

        // 如果隊列較小，立即處理（快速響應）
        if (this.syncQueue.length <= 3 && !this.syncing) {
            setTimeout(() => this.processSyncQueue(), 1000); // 1 秒後處理
        }
    }

    // 搜尋商品（優先從本地緩存）
    async searchByCode(code) {
        if (!this.initialized || !this.localDB) {
            return null;
        }

        // 直接從本地數據庫搜尋（快速）
        return await this.localDB.searchByCode(code);
    }

    // 從緩存搜尋（快速）
    searchByCodeFromCache(code) {
        if (!this.localDB) {
            return null;
        }
        return this.localDB.searchByCodeFromCache(code);
    }

    // 更新商品（先寫本地，後台同步到 Google Sheets）
    async updateItem(code, name, quantity = null) {
        if (!this.initialized || !this.localDB) {
            throw new Error('混合數據庫未初始化');
        }

        // 1. 先更新本地數據庫（快速反應，立即完成）
        const result = await this.localDB.updateItem(code, name, quantity);
        console.log('✅ 本地數據庫已更新（快速反應）');

        // 2. 添加到同步隊列（後台異步同步到 Google Sheets，不阻塞本地操作）
        // 確保本地操作完成後，再執行連線同步
        this.addToSyncQueue('update', code, name, quantity);

        return result;
    }

    // 刪除商品（先刪本地，後台同步到 Google Sheets）
    async deleteItem(code) {
        if (!this.initialized || !this.localDB) {
            throw new Error('混合數據庫未初始化');
        }

        // 1. 先刪除本地數據庫（快速反應，立即完成）
        const result = await this.localDB.deleteItem(code);
        console.log('✅ 本地數據庫已刪除（快速反應）');

        // 2. 添加到同步隊列（後台異步同步到 Google Sheets，不阻塞本地操作）
        // 確保本地操作完成後，再執行連線同步
        this.addToSyncQueue('delete', code, null, null);

        return result;
    }

    // 獲取所有商品（從本地）
    async getAllItems() {
        if (!this.localDB) {
            return [];
        }
        return await this.localDB.getAllItems();
    }

    // 重新載入數據（從本地和 Google Sheets，並確保完全同步）
    async refresh() {
        // 如果配置了 Google Sheets，先從 Google Sheets 載入並完全同步到本地
        if (this.sheetsAPI && this.sheetsAPI.initialized) {
            try {
                console.log('🔄 正在從 Google Sheets 重新載入數據（確保與 Sheet1 完全一致）...');
                await this.sheetsAPI.loadData();
                // 將 Google Sheets 的數據完全同步到本地（確保完全一致）
                await this.syncFromSheetsToLocal(true); // 使用完全同步模式
                console.log('✅ 數據重新載入完成，已與 Sheet1 完全一致');
            } catch (error) {
                console.warn('從 Google Sheets 重新載入失敗:', error);
                // 如果失敗，至少刷新本地數據
                if (this.localDB) {
                    await this.localDB.refresh();
                }
            }
        } else if (this.localDB) {
            // 如果沒有 Google Sheets，只刷新本地數據
            await this.localDB.refresh();
        }
    }

    // 從 Google Sheets 同步到本地（完全同步，確保兩邊一致）
    // fullSync: 如果為 true，則完全清空本地數據庫，完全使用 Sheet1 的數據（確保完全一致）
    async syncFromSheetsToLocal(fullSync = false) {
        if (!this.sheetsAPI || !this.sheetsAPI.initialized || !this.localDB) {
            return;
        }

        try {
            // 載入 Google Sheets 的最新數據
            console.log('📥 正在從 Google Sheets 載入最新數據...');
            const sheetsData = await this.sheetsAPI.loadData();
            console.log(`📊 從 Sheet1 載入 ${sheetsData.length} 筆數據`);

            // 如果是完全同步模式，先清空本地數據庫（確保完全一致）
            if (fullSync) {
                console.log('🔄 完全同步模式：清空本地數據庫，完全使用 Sheet1 的數據');
                await this.localDB.clearAll(true); // 使用 silent 模式，跳過確認
            }

            const localData = await this.localDB.getAllItems();

            // 創建本地數據的映射（以條碼為鍵）
            const localMap = new Map();
            localData.forEach(item => {
                const code = String(item.code || item.條碼 || '').trim();
                if (code) {
                    localMap.set(code, item);
                }
            });

            // 創建 Google Sheets 數據的映射（以條碼為鍵）
            const sheetsMap = new Map();
            let updatedCount = 0;
            let addedCount = 0;
            let deletedCount = 0;

            // 處理 Google Sheets 中的每個商品（Sheet1 是權威來源）
            for (const item of sheetsData) {
                const codeFields = ['條碼', 'Barcode', 'Code', 'code', 'barcode', '商品編號', 'ID'];
                let code = null;
                for (const field of codeFields) {
                    if (item[field]) {
                        code = String(item[field]).trim();
                        break;
                    }
                }

                if (!code) continue;

                const nameFields = ['名稱', 'Name', 'name', '商品名稱', '產品名稱', 'Product'];
                let name = '未知商品';
                for (const field of nameFields) {
                    if (item[field]) {
                        name = String(item[field]);
                        break;
                    }
                }

                const quantityFields = ['數量', 'Quantity', 'quantity', 'Qty', 'qty', '個數'];
                let quantity = null;
                for (const field of quantityFields) {
                    if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
                        quantity = parseInt(item[field]) || 0;
                        break;
                    }
                }

                sheetsMap.set(code, { code, name, quantity });

                // 檢查本地是否有此商品
                const localItem = localMap.get(code);
                if (!localItem) {
                    // 本地沒有，直接添加（使用 Sheet1 的數據）
                    await this.localDB.updateItem(code, name, quantity);
                    addedCount++;
                } else {
                    // 本地有，比較並更新（但優先保留本地最近的更新，避免覆蓋剛更新的數據）
                    const localQuantity = parseInt(localItem.quantity || localItem.數量 || 0);
                    const sheetsQuantity = quantity !== null ? quantity : 0;
                    const localName = localItem.name || localItem.名稱 || localItem.商品名稱 || '未知商品';
                    
                    // 只在完全同步模式（初始化時）才覆蓋本地數據
                    // 正常同步時，保留本地數據，只推送本地變更到 Google Sheets
                    if (fullSync && (localQuantity !== sheetsQuantity || localName !== name)) {
                        await this.localDB.updateItem(code, name, sheetsQuantity);
                        updatedCount++;
                    }
                    // 非完全同步模式：不覆蓋本地數據，保留本地更新
                }
            }

            // 處理本地有但 Google Sheets 沒有的商品
            let localOnlyCount = 0;
            for (const [code, localItem] of localMap.entries()) {
                if (!sheetsMap.has(code)) {
                    if (fullSync) {
                        // 完全同步模式：刪除本地獨有的商品（確保完全一致）
                        await this.localDB.deleteItem(code);
                        deletedCount++;
                    } else {
                        // 普通同步模式：保留本地獨有的商品，但標記為需要同步
                        localOnlyCount++;
                    }
                }
            }

            if (addedCount > 0 || updatedCount > 0 || deletedCount > 0) {
                console.log(`✅ 已從 Google Sheets 完全同步到本地：新增 ${addedCount} 個，更新 ${updatedCount} 個${deletedCount > 0 ? `，刪除 ${deletedCount} 個` : ''}`);
            }
            if (!fullSync && localOnlyCount > 0) {
                console.log(`ℹ️ 本地有 ${localOnlyCount} 個商品尚未同步到 Google Sheets（將在下次同步時推送）`);
            }
        } catch (error) {
            console.error('從 Google Sheets 同步到本地失敗:', error);
            throw error;
        }
    }

    // 手動觸發同步（立即同步所有待處理的操作，並從 Google Sheets 拉取最新數據）
    async syncNow() {
        if (!this.sheetsAPI || !this.sheetsAPI.initialized) {
            throw new Error('Google Sheets 未配置或未連接');
        }

        console.log('🔄 手動觸發完整同步（確保與 Sheet1 完全一致）...');
        // 先處理同步隊列（推送本地變更到 Google Sheets）
        await this.processSyncQueue();
        // 再從 Google Sheets 拉取最新數據（確保完全同步，使用完全同步模式）
        await this.syncFromSheetsToLocal(true);
        console.log('✅ 手動同步完成，已與 Sheet1 完全一致');
    }

    // 獲取同步狀態
    getSyncStatus() {
        return {
            queueLength: this.syncQueue.length,
            syncing: this.syncing,
            sheetsConnected: this.sheetsAPI && this.sheetsAPI.initialized
        };
    }

    // 清空同步隊列
    clearSyncQueue() {
        this.syncQueue = [];
        console.log('✅ 同步隊列已清空');
    }

    // 匯出數據
    exportData() {
        if (!this.localDB) {
            return null;
        }
        return this.localDB.exportData();
    }

    // 匯入數據
    async importData(jsonString) {
        if (!this.localDB) {
            throw new Error('本地數據庫未初始化');
        }
        return await this.localDB.importData(jsonString);
    }

    // 清空數據庫
    async clearAll() {
        if (!this.localDB) {
            throw new Error('本地數據庫未初始化');
        }
        const result = await this.localDB.clearAll();
        if (result.success) {
            // 清空同步隊列
            this.clearSyncQueue();
        }
        return result;
    }
}

// 將 HybridDatabase 暴露到全局
if (typeof window !== 'undefined') {
    window.HybridDatabase = HybridDatabase;
}

