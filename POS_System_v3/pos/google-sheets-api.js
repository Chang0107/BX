// Google Sheets API 整合（支持直接模式和後端模式）
// 自動檢測並使用最適合的模式

class GoogleSheetsAPI {
    constructor() {
        this.spreadsheetId = '';
        this.sheetName = 'Sheet1';
        this.dataCache = [];
        this.initialized = false;
        this.mode = 'auto'; // 'direct', 'backend', 'auto'
        this.apiBaseUrl = 'http://localhost:3000/api';
        this.directAPI = null; // 直接模式 API 實例
    }

    // 初始化配置（強制使用直接模式）
    async init(config) {
        if (config.spreadsheetId) this.spreadsheetId = String(config.spreadsheetId).trim();
        if (config.sheetName) this.sheetName = String(config.sheetName).trim();
        
        // 強制使用直接模式（無需後端）
        this.mode = 'direct';
        this.apiBaseUrl = undefined; // 直接模式不需要 API URL
        
        if (!this.spreadsheetId) {
            console.error('請設置 Spreadsheet ID');
            return false;
        }

        // 只使用直接模式（無需後端）
        try {
            await this.initDirectMode(config);
            console.log('✅ 直接模式初始化成功');
        } catch (error) {
            console.error('直接模式初始化失敗:', error);
            // 提供更詳細的錯誤信息
            const errorMsg = error.message || '初始化失敗';
            if (errorMsg.includes('服務帳戶') || errorMsg.includes('憑證')) {
                throw new Error('無法載入服務帳戶憑證。請確保 service-account-key.json 文件存在且格式正確。');
            }
            throw error; // 直接模式失敗時拋出錯誤，不嘗試後端模式
        }

        // 載入資料（這會測試連接）
        try {
            await this.loadData();
            console.log('✅ 資料載入成功，連接正常');
        } catch (error) {
            console.error('載入資料失敗:', error);
            // 即使載入失敗，也標記為已初始化（配置正確）
            this.initialized = true;
            throw error; // 重新拋出錯誤，讓上層處理
        }
        
        this.initialized = true;
        return true;
    }

    // 檢測應該使用的模式
    async detectMode() {
        // 優先檢查系統配置
        if (typeof window !== 'undefined' && window.SYSTEM_CONFIG) {
            const sysConfig = window.SYSTEM_CONFIG;
            if (sysConfig.defaultMode) {
                return sysConfig.defaultMode;
            }
        }
        
        // 檢查是否有服務帳戶憑證
        const hasServiceAccount = await this.checkServiceAccountAvailable();
        
        // 檢查是否在 Android/Capacitor 環境
        const isCapacitor = typeof Capacitor !== 'undefined';
        
        // 如果沒有後端服務器且有關鍵憑證，使用直接模式
        if (hasServiceAccount && (isCapacitor || !this.apiBaseUrl.includes('localhost'))) {
            return 'direct';
        }
        
        // 默認使用直接模式（無需後端）
        return 'direct';
    }

    // 檢查服務帳戶是否可用
    async checkServiceAccountAvailable() {
        try {
            // 檢查 localStorage
            const saved = localStorage.getItem('serviceAccountKey');
            if (saved) {
                return true;
            }

            // 檢查文件（適用於網站版）
            try {
                const response = await fetch('service-account-key.json');
                if (response.ok) {
                    return true;
                }
            } catch (e) {
                // 忽略錯誤
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    // 初始化直接模式
    async initDirectMode(config) {
        if (!window.GoogleSheetsDirectAPI) {
            throw new Error('直接模式 API 未載入，請確保 google-sheets-direct.js 已載入');
        }

        this.directAPI = new window.GoogleSheetsDirectAPI();
        await this.directAPI.init({
            spreadsheetId: this.spreadsheetId,
            sheetName: this.sheetName,
            serviceAccount: config.serviceAccount
        });
    }

    // 從 Google Sheets 載入資料
    async loadData() {
        if (this.mode === 'direct' && this.directAPI) {
            this.dataCache = await this.directAPI.loadData();
            return this.dataCache;
        } else {
            // 後端模式
            return await this.loadDataFromBackend();
        }
    }

    // 從後端載入資料
    async loadDataFromBackend() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/sheets/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    spreadsheetId: this.spreadsheetId,
                    sheetName: this.sheetName,
                    range: 'A:Z'
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            this.dataCache = result.data || [];
            
            return this.dataCache;
        } catch (error) {
            console.error('載入 Google Sheets 資料失敗:', error);
            
            // 如果後端模式失敗，嘗試切換到直接模式
            if (this.mode === 'backend' || this.mode === 'auto') {
                try {
                    await this.initDirectMode({});
                    this.mode = 'direct';
                    return await this.loadData();
                } catch (e) {
                    console.error('切換到直接模式失敗:', e);
                }
            }
            
            this.showError('無法連接到 Google Sheets，請檢查後端服務是否運行或服務帳戶憑證是否正確');
            return [];
        }
    }

    // 搜尋商品（根據條碼）
    async searchByCode(code) {
        if (!this.initialized) {
            this.showError('系統尚未初始化');
            return null;
        }

        if (this.mode === 'direct' && this.directAPI) {
            return await this.directAPI.searchByCode(code);
        } else {
            // 後端模式
            try {
                const response = await fetch(`${this.apiBaseUrl}/sheets/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        spreadsheetId: this.spreadsheetId,
                        sheetName: this.sheetName,
                        code: code
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                return result.item || null;
            } catch (error) {
                console.error('搜尋商品失敗:', error);
                // 如果 API 失敗，嘗試從快取中搜尋
                return this.searchByCodeFromCache(code);
            }
        }
    }

    // 從快取中搜尋（備用方案）
    searchByCodeFromCache(code) {
        const codeFields = ['條碼', 'Barcode', 'Code', 'code', 'barcode', '商品編號', 'ID'];
        
        for (const field of codeFields) {
            const item = this.dataCache.find(row => 
                String(row[field] || '').trim() === String(code).trim()
            );
            if (item) {
                return item;
            }
        }

        // 如果沒有找到，嘗試在所有欄位中搜尋
        for (const item of this.dataCache) {
            for (const value of Object.values(item)) {
                if (String(value).trim() === String(code).trim()) {
                    return item;
                }
            }
        }

        return null;
    }

    // 顯示錯誤訊息
    showError(message) {
        console.error(message);
    }

    // 獲取所有資料
    getAllData() {
        return this.dataCache;
    }

    // 重新載入資料
    async refresh() {
        await this.loadData();
    }

    // 更新商品到 Google Sheets（新增或更新，支持數量）
    async updateItem(code, name, quantity = null) {
        if (this.mode === 'direct' && this.directAPI) {
            return await this.directAPI.updateItem(code, name, quantity);
        } else {
            // 後端模式（暫時不支持數量參數，使用直接模式）
            return await this.updateItemViaBackend(code, name);
        }
    }

    // 刪除商品（當數量為 0 時使用）
    async deleteItem(code) {
        if (this.mode === 'direct' && this.directAPI) {
            return await this.directAPI.deleteItem(code);
        } else {
            throw new Error('刪除功能僅支持直接模式');
        }
    }

    // 通過後端更新商品
    async updateItemViaBackend(code, name) {
        try {
            // 先檢查後端服務是否可用（使用超時處理）
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            let testResponse = null;
            try {
                testResponse = await fetch(`${this.apiBaseUrl.replace('/api', '')}/`, {
                    method: 'GET',
                    signal: controller.signal
                });
            } catch (e) {
                if (e.name === 'AbortError') {
                    // 後端不可用，嘗試切換到直接模式
                    if (this.mode === 'backend' || this.mode === 'auto') {
                        try {
                            await this.initDirectMode({});
                            this.mode = 'direct';
                            return await this.updateItem(code, name);
                        } catch (directError) {
                            throw new Error('無法連接到後端服務器，且直接模式初始化失敗');
                        }
                    }
                    throw new Error('無法連接到後端服務器（連接超時），請確認服務器是否運行');
                }
            } finally {
                clearTimeout(timeoutId);
            }

            if (!testResponse || !testResponse.ok) {
                // 後端不可用，嘗試切換到直接模式
                if (this.mode === 'backend' || this.mode === 'auto') {
                    try {
                        await this.initDirectMode({});
                        this.mode = 'direct';
                        return await this.updateItem(code, name);
                    } catch (directError) {
                        throw new Error('無法連接到後端服務器，且直接模式初始化失敗');
                    }
                }
                throw new Error('無法連接到後端服務器，請確認服務器是否運行');
            }

            // 發送更新請求（使用超時處理）
            const updateController = new AbortController();
            const updateTimeoutId = setTimeout(() => updateController.abort(), 30000);
            
            let response;
            try {
                response = await fetch(`${this.apiBaseUrl}/sheets/update`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        spreadsheetId: this.spreadsheetId,
                        sheetName: this.sheetName,
                        code: code,
                        name: name
                    }),
                    signal: updateController.signal
                });
            } catch (e) {
                if (e.name === 'AbortError') {
                    throw new Error('請求超時，請檢查網絡連接或 Google Sheets 服務狀態');
                }
                throw e;
            } finally {
                clearTimeout(updateTimeoutId);
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({ 
                    error: '未知錯誤', 
                    message: `HTTP ${response.status}: ${response.statusText}` 
                }));
                
                let errorMessage = error.message || error.error || '更新失敗';
                
                // 提供更詳細的錯誤信息
                if (response.status === 500) {
                    if (errorMessage.includes('服務帳戶未初始化')) {
                        errorMessage = '服務帳戶未初始化，請檢查 service-account-key.json 文件';
                    } else if (errorMessage.includes('權限')) {
                        errorMessage = '權限不足，請確認服務帳戶郵件已添加到 Google Sheets 的共用設定中';
                    } else {
                        errorMessage = `服務器錯誤: ${errorMessage}`;
                    }
                } else if (response.status === 400) {
                    errorMessage = `請求錯誤: ${errorMessage}`;
                } else if (response.status === 404) {
                    errorMessage = 'API 端點不存在，請檢查後端服務器版本';
                }
                
                throw new Error(errorMessage);
            }

            const result = await response.json();
            
            // 更新後重新載入資料
            await this.refresh();
            
            return result;
        } catch (error) {
            console.error('更新 Google Sheets 失敗:', error);
            
            // 如果是網絡錯誤，提供更詳細的信息
            if (error.name === 'AbortError') {
                throw new Error('請求超時，請檢查網絡連接或 Google Sheets 服務狀態');
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                // 嘗試切換到直接模式
                if (this.mode === 'backend' || this.mode === 'auto') {
                    try {
                        await this.initDirectMode({});
                        this.mode = 'direct';
                        return await this.updateItem(code, name);
                    } catch (directError) {
                        throw new Error('無法連接到後端服務器，且直接模式初始化失敗。請確認：\n1. 後端服務器是否運行（npm start）\n2. 服務器地址是否正確\n3. 服務帳戶憑證是否可用');
                    }
                }
                throw new Error('無法連接到後端服務器，請確認：\n1. 後端服務器是否運行（npm start）\n2. 服務器地址是否為 http://localhost:3000');
            }
            
            throw error;
        }
    }
}

// 匯出單例
window.googleSheetsAPI = new GoogleSheetsAPI();
