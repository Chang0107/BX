// 本地數據庫 API（不使用 Google Sheets）
// 使用 localStorage 存儲商品數據

class LocalDatabase {
    constructor() {
        this.storageKey = 'pos_local_database';
        this.dataCache = [];
        this.initialized = false;
    }

    // 初始化本地數據庫
    async init(config = {}) {
        try {
            // 載入現有數據
            await this.loadData();
            this.initialized = true;
            console.log('✅ 本地數據庫初始化成功');
            return true;
        } catch (error) {
            console.error('❌ 本地數據庫初始化失敗:', error);
            this.initialized = false;
            return false;
        }
    }

    // 載入所有數據
    async loadData() {
        try {
            const savedData = localStorage.getItem(this.storageKey);
            if (savedData) {
                this.dataCache = JSON.parse(savedData);
                console.log(`✅ 載入 ${this.dataCache.length} 筆商品數據`);
            } else {
                // 初始化空數據庫
                this.dataCache = [];
                this.saveData();
                console.log('✅ 創建新的本地數據庫');
            }
            return this.dataCache;
        } catch (error) {
            console.error('❌ 載入數據失敗:', error);
            this.dataCache = [];
            return [];
        }
    }

    // 保存數據到 localStorage
    saveData() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.dataCache));
            return true;
        } catch (error) {
            console.error('❌ 保存數據失敗:', error);
            // 如果數據太大，嘗試清理舊數據
            if (error.name === 'QuotaExceededError') {
                console.warn('⚠️ 存儲空間不足，嘗試清理舊數據...');
                this.cleanOldData();
            }
            return false;
        }
    }

    // 清理舊數據（保留最近 1000 筆）
    cleanOldData() {
        if (this.dataCache.length > 1000) {
            this.dataCache = this.dataCache.slice(-1000);
            this.saveData();
            console.log('✅ 已清理舊數據，保留最近 1000 筆');
        }
    }

    // 根據條碼搜尋商品
    async searchByCode(code) {
        if (!this.initialized) {
            await this.loadData();
        }

        const normalizedCode = String(code).trim();
        const item = this.dataCache.find(item => {
            const itemCode = String(item.code || item.條碼 || '').trim();
            return itemCode === normalizedCode;
        });

        if (item) {
            // 返回標準格式，確保數量是數字類型（修復進位問題）
            const quantity = item.quantity !== undefined ? item.quantity : (item.數量 !== undefined ? item.數量 : 0);
            const numQuantity = Number(quantity);
            const finalQuantity = isNaN(numQuantity) ? 0 : Math.floor(numQuantity);
            
            return {
                code: item.code || item.條碼,
                name: item.name || item.名稱 || item.商品名稱,
                price: item.price || item.價格 || 0,
                quantity: finalQuantity,
                數量: finalQuantity
            };
        }

        return null;
    }

    // 從緩存搜尋（快速）
    searchByCodeFromCache(code) {
        const normalizedCode = String(code).trim();
        const item = this.dataCache.find(item => {
            const itemCode = String(item.code || item.條碼 || '').trim();
            return itemCode === normalizedCode;
        });

        if (item) {
            return {
                code: item.code || item.條碼,
                name: item.name || item.名稱 || item.商品名稱,
                price: item.price || item.價格 || 0,
                quantity: item.quantity || item.數量 || 0
            };
        }

        return null;
    }

    // 新增或更新商品
    async updateItem(code, name, quantity = null) {
        if (!this.initialized) {
            await this.loadData();
        }

        const normalizedCode = String(code).trim();
        const existingIndex = this.dataCache.findIndex(item => {
            const itemCode = String(item.code || item.條碼 || '').trim();
            return itemCode === normalizedCode;
        });

        const itemData = {
            code: normalizedCode,
            條碼: normalizedCode,
            name: name || '未知商品',
            名稱: name || '未知商品',
            商品名稱: name || '未知商品',
            updatedAt: new Date().toISOString()
        };

        if (quantity !== null) {
            // 確保數量是數字類型（修復超過10時亂跳的問題）
            const numQuantity = Number(quantity);
            itemData.quantity = isNaN(numQuantity) ? 0 : Math.floor(numQuantity);
            itemData.數量 = itemData.quantity;
        }

        if (existingIndex >= 0) {
            // 更新現有商品
            this.dataCache[existingIndex] = {
                ...this.dataCache[existingIndex],
                ...itemData
            };
            console.log(`✅ 更新商品: ${normalizedCode} - ${name}`);
        } else {
            // 新增商品
            itemData.createdAt = new Date().toISOString();
            this.dataCache.push(itemData);
            console.log(`✅ 新增商品: ${normalizedCode} - ${name}`);
        }

        this.saveData();
        return { message: existingIndex >= 0 ? '商品已更新' : '商品已新增', action: existingIndex >= 0 ? 'update' : 'append' };
    }

    // 更新商品數量
    async updateQuantity(code, quantity) {
        if (!this.initialized) {
            await this.loadData();
        }

        const normalizedCode = String(code).trim();
        const item = this.dataCache.find(item => {
            const itemCode = String(item.code || item.條碼 || '').trim();
            return itemCode === normalizedCode;
        });

        if (item) {
            item.quantity = quantity;
            item.數量 = quantity;
            item.updatedAt = new Date().toISOString();
            this.saveData();
            return { message: '數量已更新', success: true };
        }

        return { message: '商品不存在', success: false };
    }

    // 刪除商品
    async deleteItem(code) {
        if (!this.initialized) {
            await this.loadData();
        }

        const normalizedCode = String(code).trim();
        const index = this.dataCache.findIndex(item => {
            const itemCode = String(item.code || item.條碼 || '').trim();
            return itemCode === normalizedCode;
        });

        if (index >= 0) {
            this.dataCache.splice(index, 1);
            this.saveData();
            console.log(`✅ 刪除商品: ${normalizedCode}`);
            return { message: '商品已刪除', success: true };
        }

        return { message: '商品不存在', success: false };
    }

    // 獲取所有商品
    async getAllItems() {
        if (!this.initialized) {
            await this.loadData();
        }
        return this.dataCache;
    }

    // 匯出數據為 JSON
    exportData() {
        return JSON.stringify(this.dataCache, null, 2);
    }

    // 從 JSON 匯入數據
    async importData(jsonString) {
        try {
            const importedData = JSON.parse(jsonString);
            if (Array.isArray(importedData)) {
                this.dataCache = importedData;
                this.saveData();
                console.log(`✅ 匯入 ${importedData.length} 筆數據`);
                return { success: true, count: importedData.length };
            } else {
                throw new Error('數據格式錯誤：必須是陣列');
            }
        } catch (error) {
            console.error('❌ 匯入數據失敗:', error);
            return { success: false, error: error.message };
        }
    }

    // 清空數據庫
    async clearAll(silent = false) {
        // silent 為 true 時跳過確認（用於自動同步）
        if (!silent && !confirm('確定要清空所有商品數據嗎？此操作無法復原！')) {
            return { success: false, message: '已取消' };
        }
        this.dataCache = [];
        this.saveData();
        console.log('✅ 數據庫已清空');
        return { success: true, message: '數據庫已清空' };
    }

    // 重新載入數據
    async refresh() {
        await this.loadData();
    }
}

// 將 LocalDatabase 暴露到全局
if (typeof window !== 'undefined') {
    window.LocalDatabase = LocalDatabase;
}











