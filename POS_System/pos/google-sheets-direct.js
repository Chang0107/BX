// Google Sheets API 直接調用實現（無需後端服務器）
// 使用服務帳戶憑證直接調用 Google Sheets REST API

class GoogleSheetsDirectAPI {
    constructor() {
        this.spreadsheetId = '';
        this.sheetName = 'Sheet1';
        this.dataCache = [];
        this.initialized = false;
        this.serviceAccount = null;
        this.accessToken = null;
        this.tokenExpiry = 0;
    }

    // 初始化配置
    async init(config) {
        if (config.spreadsheetId) this.spreadsheetId = String(config.spreadsheetId).trim();
        if (config.sheetName) this.sheetName = String(config.sheetName).trim();
        
        // 載入服務帳戶憑證
        if (config.serviceAccount) {
            this.serviceAccount = config.serviceAccount;
        } else {
            // 嘗試從文件或 localStorage 載入
            await this.loadServiceAccount();
        }
        
        if (!this.spreadsheetId) {
            console.error('請設置 Spreadsheet ID');
            return false;
        }

        // 獲取訪問令牌（必須）
        if (!this.serviceAccount) {
            throw new Error('服務帳戶憑證未載入。請確保 service-account-key.json 文件存在。');
        }

        try {
            await this.getAccessToken();
            console.log('✅ 訪問令牌獲取成功');
        } catch (error) {
            console.error('獲取訪問令牌失敗:', error);
            throw new Error('無法獲取 Google API 訪問令牌：' + (error.message || '請檢查服務帳戶憑證'));
        }

        // 注意：不在此處調用 loadData，由上層調用
        this.initialized = true;
        return true;
    }

    // 載入服務帳戶憑證
    async loadServiceAccount() {
        try {
            // 嘗試從 localStorage 載入
            const saved = localStorage.getItem('serviceAccountKey');
            if (saved) {
                this.serviceAccount = JSON.parse(saved);
                return;
            }

            // 嘗試從文件載入（適用於網站版和 Android/Capacitor）
            // 優先通過 HTTP 服務器訪問（解決瀏覽器安全限制）
            const possiblePaths = [
                '/service-account-key.json',   // 通過 HTTP 服務器（優先）
                './service-account-key.json',   // 相對路徑
                'service-account-key.json',     // 當前目錄
                'assets/service-account-key.json'  // Android assets
            ];

            for (const path of possiblePaths) {
                try {
                    console.log('嘗試載入服務帳戶憑證:', path);
                    const response = await fetch(path, {
                        method: 'GET',
                        cache: 'no-cache'
                    });
                    
                    if (response.ok) {
                        const jsonData = await response.json();
                        // 驗證 JSON 格式
                        if (jsonData && jsonData.type === 'service_account' && jsonData.private_key) {
                            this.serviceAccount = jsonData;
                            localStorage.setItem('serviceAccountKey', JSON.stringify(this.serviceAccount));
                            console.log('✅ 服務帳戶憑證已從文件載入:', path);
                            return;
                        } else {
                            console.warn('服務帳戶憑證格式不正確:', path);
                        }
                    } else {
                        console.warn('無法載入服務帳戶憑證:', path, '狀態:', response.status);
                    }
                } catch (e) {
                    console.warn('載入服務帳戶憑證失敗:', path, e.message);
                    // 繼續嘗試下一個路徑
                }
            }

            // 如果所有路徑都失敗，嘗試使用 Capacitor Filesystem 插件（如果可用）
            if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.Filesystem) {
                try {
                    const content = await Capacitor.Plugins.Filesystem.readFile({
                        path: 'service-account-key.json',
                        directory: Capacitor.Plugins.FilesystemDirectory.Data
                    });
                    this.serviceAccount = JSON.parse(content.data);
                    localStorage.setItem('serviceAccountKey', content.data);
                    console.log('✅ 服務帳戶憑證已從文件系統載入');
                    return;
                } catch (e) {
                    console.warn('無法從文件系統載入憑證:', e);
                }
            }

            console.warn('⚠️  無法載入服務帳戶憑證，請確保 service-account-key.json 文件存在');
        } catch (error) {
            console.error('載入服務帳戶憑證失敗:', error);
        }
    }

    // 使用 JWT 獲取訪問令牌
    async getAccessToken() {
        // 如果令牌還有效，直接返回
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        try {
            // 創建 JWT
            const jwt = await this.createJWT();
            
            // 使用 JWT 獲取訪問令牌
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                    assertion: jwt
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`獲取訪問令牌失敗: ${error.error_description || error.error}`);
            }

            const data = await response.json();
            this.accessToken = data.access_token;
            // 設置過期時間（提前 5 分鐘刷新）
            this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
            
            return this.accessToken;
        } catch (error) {
            console.error('獲取訪問令牌失敗:', error);
            throw error;
        }
    }

    // 創建 JWT（JSON Web Token）
    async createJWT() {
        if (!this.serviceAccount) {
            throw new Error('服務帳戶憑證未載入');
        }

        const now = Math.floor(Date.now() / 1000);
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        const claim = {
            iss: this.serviceAccount.client_email,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600, // 1 小時後過期
            iat: now
        };

        // 使用 Web Crypto API 簽名 JWT
        const headerB64 = this.base64UrlEncode(JSON.stringify(header));
        const claimB64 = this.base64UrlEncode(JSON.stringify(claim));
        const unsignedJWT = `${headerB64}.${claimB64}`;

        // 導入私鑰
        const privateKey = await this.importPrivateKey(this.serviceAccount.private_key);
        
        // 簽名
        const signature = await crypto.subtle.sign(
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: { name: 'SHA-256' }
            },
            privateKey,
            new TextEncoder().encode(unsignedJWT)
        );

        const signatureB64 = this.base64UrlEncode(
            String.fromCharCode(...new Uint8Array(signature))
        );

        return `${unsignedJWT}.${signatureB64}`;
    }

    // 導入私鑰
    async importPrivateKey(pemKey) {
        // 移除 PEM 格式的標記和換行符
        const pemHeader = '-----BEGIN PRIVATE KEY-----';
        const pemFooter = '-----END PRIVATE KEY-----';
        const pemContents = pemKey
            .replace(pemHeader, '')
            .replace(pemFooter, '')
            .replace(/\s/g, '');

        // 解碼 Base64
        const binaryDer = this.base64Decode(pemContents);

        // 導入為 CryptoKey
        return await crypto.subtle.importKey(
            'pkcs8',
            binaryDer,
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: 'SHA-256'
            },
            false,
            ['sign']
        );
    }

    // Base64 URL 編碼
    base64UrlEncode(str) {
        return btoa(str)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    // Base64 解碼
    base64Decode(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // 從 Google Sheets 載入資料
    async loadData() {
        try {
            const token = await this.getAccessToken();
            
            // 先獲取工作表列表，確認工作表名稱
            let actualSheetName = this.sheetName;
            try {
                const spreadsheetResponse = await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?access_token=${token}`
                );
                
                if (spreadsheetResponse.ok) {
                    const spreadsheet = await spreadsheetResponse.json();
                    const sheets = spreadsheet.sheets || [];
                    if (sheets.length > 0) {
                        const targetSheet = sheets.find(s => s.properties.title === actualSheetName);
                        if (!targetSheet) {
                            actualSheetName = sheets[0].properties.title;
                            console.log(`找不到工作表 "${this.sheetName}"，使用第一個工作表: "${actualSheetName}"`);
                        }
                    }
                }
            } catch (e) {
                console.warn('無法獲取工作表列表，使用原始名稱:', e);
            }

            // 構建範圍
            const needsQuotes = /[\s\-'"]/.test(actualSheetName);
            const range = needsQuotes 
                ? `'${actualSheetName.replace(/'/g, "''")}'!A:Z` 
                : `${actualSheetName}!A:Z`;

            const response = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?access_token=${token}`
            );

            if (!response.ok) {
                const error = await response.json();
                let errorMessage = error.error?.message || `HTTP error! status: ${response.status}`;
                
                // 提供更友好的錯誤訊息
                if (response.status === 404) {
                    errorMessage = `找不到試算表（404）。請檢查：
1. Spreadsheet ID 是否正確：${this.spreadsheetId}
2. 服務帳戶是否已添加到試算表的共用設定
3. 試算表是否存在且未被刪除`;
                } else if (response.status === 403) {
                    errorMessage = `權限不足（403）。請確認服務帳戶已添加到試算表的共用設定，並設為「編輯者」權限`;
                }
                
                throw new Error(errorMessage);
            }

            const result = await response.json();
            const rows = result.values || [];

            if (rows.length === 0) {
                this.dataCache = [];
                return [];
            }

            // 將資料轉換為物件陣列
            const headers = rows[0];
            this.dataCache = rows.slice(1).map(row => {
                const item = {};
                headers.forEach((header, index) => {
                    item[header] = row[index] || '';
                });
                return item;
            });

            return this.dataCache;
        } catch (error) {
            console.error('載入 Google Sheets 資料失敗:', error);
            this.showError('無法連接到 Google Sheets: ' + error.message);
            return [];
        }
    }

    // 搜尋商品（根據條碼）
    async searchByCode(code) {
        if (!this.initialized) {
            console.error('系統尚未初始化');
            return null;
        }

        // 先從快取中搜尋
        const cached = this.searchByCodeFromCache(code);
        if (cached) {
            return cached;
        }

        // 如果快取中沒有，重新載入資料
        try {
            await this.loadData();
            const result = this.searchByCodeFromCache(code);
            if (!result) {
                console.log(`未找到條碼: ${code}，快取中有 ${this.dataCache.length} 筆資料`);
            }
            return result;
        } catch (error) {
            console.error('載入資料失敗:', error);
            return null;
        }
    }

    // 從快取中搜尋
    searchByCodeFromCache(code) {
        if (!this.dataCache || this.dataCache.length === 0) {
            return null;
        }
        
        const codeFields = ['條碼', 'Barcode', 'Code', 'code', 'barcode', '商品編號', 'ID'];
        const codeStr = String(code).trim();
        
        // 先嘗試在條碼欄位中搜尋
        for (const field of codeFields) {
            const item = this.dataCache.find(row => {
                const value = row[field];
                if (value === null || value === undefined) return false;
                return String(value).trim() === codeStr;
            });
            if (item) {
                return item;
            }
        }

        // 如果沒有找到，嘗試在所有欄位中搜尋（更寬鬆的匹配）
        for (const item of this.dataCache) {
            for (const value of Object.values(item)) {
                if (value !== null && value !== undefined) {
                    if (String(value).trim() === codeStr) {
                        return item;
                    }
                }
            }
        }

        return null;
    }

    // 更新商品到 Google Sheets（新增或更新，支持數量）
    async updateItem(code, name, quantity = null) {
        try {
            const token = await this.getAccessToken();
            
            // 先讀取現有資料
            const needsQuotes = /[\s\-'"]/.test(this.sheetName);
            const range = needsQuotes 
                ? `'${this.sheetName.replace(/'/g, "''")}'!A:Z` 
                : `${this.sheetName}!A:Z`;

            const readResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?access_token=${token}`
            );

            if (!readResponse.ok) {
                const errorData = await readResponse.json().catch(() => ({}));
                let errorMessage = '無法讀取工作表';
                
                if (readResponse.status === 404) {
                    errorMessage = `找不到試算表（404）。請檢查：
1. Spreadsheet ID 是否正確：${this.spreadsheetId}
2. 工作表名稱是否正確：${this.sheetName}
3. 服務帳戶是否已添加到試算表的共用設定`;
                } else if (readResponse.status === 403) {
                    errorMessage = `權限不足（403）。請確認服務帳戶已添加到試算表的共用設定，並設為「編輯者」權限`;
                } else {
                    errorMessage = errorData.error?.message || `HTTP ${readResponse.status}: ${errorMessage}`;
                }
                
                throw new Error(errorMessage);
            }

            const readData = await readResponse.json();
            const rows = readData.values || [];

            // 如果工作表為空，創建標題行（包含價格欄位）
            if (rows.length === 0) {
                const headerRange = needsQuotes 
                    ? `'${this.sheetName.replace(/'/g, "''")}'!A1:D1` 
                    : `${this.sheetName}!A1:D1`;
                
                await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED&access_token=${token}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            values: [['條碼', '名稱', '價格', '數量']]
                        })
                    }
                );
                // 重新讀取以獲取新的標題行
                const reReadResponse = await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?access_token=${token}`
                );
                const reReadData = await reReadResponse.json();
                rows = reReadData.values || [];
            }

            const headers = rows[0] || ['條碼', '名稱', '價格', '數量'];
            const codeFields = ['條碼', 'Barcode', 'Code', 'code', 'barcode', '商品編號', 'ID'];
            const nameFields = ['名稱', 'Name', 'name', '商品名稱', '產品名稱', 'Product'];
            const quantityFields = ['數量', 'Quantity', 'quantity', 'Qty', 'qty', '個數'];

            let codeFieldIndex = headers.findIndex(h => codeFields.includes(h));
            let nameFieldIndex = headers.findIndex(h => nameFields.includes(h));
            let quantityFieldIndex = headers.findIndex(h => quantityFields.includes(h));

            if (codeFieldIndex === -1) codeFieldIndex = 0;
            if (nameFieldIndex === -1) nameFieldIndex = 1;
            
            // 如果沒有數量欄位，添加它（在最後）
            if (quantityFieldIndex === -1) {
                quantityFieldIndex = headers.length;
                // 更新標題行，添加數量欄位
                const headerRange = needsQuotes 
                    ? `'${this.sheetName.replace(/'/g, "''")}'!${this.getColumnLetter(quantityFieldIndex)}1` 
                    : `${this.sheetName}!${this.getColumnLetter(quantityFieldIndex)}1`;
                
                await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED&access_token=${token}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            values: [['數量']]
                        })
                    }
                );
                // 更新 headers 數組
                headers[quantityFieldIndex] = '數量';
            }

            // 搜尋是否已存在
            let rowIndex = -1;
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][codeFieldIndex] || '').trim() === String(code).trim()) {
                    rowIndex = i + 1; // Google Sheets 從 1 開始
                    break;
                }
            }

            // 定義 newQuantity 變數在外部作用域，確保在所有路徑都可訪問
            let newQuantity = null;

            if (rowIndex > 0) {
                // 更新現有行（名稱和數量）
                const maxIndex = Math.max(nameFieldIndex, quantityFieldIndex);
                const startColumn = this.getColumnLetter(Math.min(nameFieldIndex, quantityFieldIndex));
                const endColumn = this.getColumnLetter(maxIndex);
                const updateRange = needsQuotes 
                    ? `'${this.sheetName.replace(/'/g, "''")}'!${startColumn}${rowIndex}:${endColumn}${rowIndex}` 
                    : `${this.sheetName}!${startColumn}${rowIndex}:${endColumn}${rowIndex}`;

                // 讀取現有數量
                const existingRow = rows[rowIndex - 1];
                let currentQuantity = 0;
                if (quantityFieldIndex >= 0 && existingRow[quantityFieldIndex]) {
                    currentQuantity = parseInt(existingRow[quantityFieldIndex]) || 0;
                }
                
                // 如果提供了數量，使用提供的數量；否則增加 1
                newQuantity = quantity !== null ? quantity : (currentQuantity + 1);
                
                // 構建更新值（需要按欄位順序）
                const updateValues = new Array(maxIndex + 1).fill('');
                updateValues[nameFieldIndex] = name || '未知商品';
                if (quantityFieldIndex >= 0) {
                    updateValues[quantityFieldIndex] = newQuantity;
                }
                
                // 只更新需要的欄位範圍
                const actualValues = [];
                for (let i = Math.min(nameFieldIndex, quantityFieldIndex); i <= maxIndex; i++) {
                    actualValues.push(updateValues[i] || '');
                }

                await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED&access_token=${token}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            values: [actualValues]
                        })
                    }
                );

                // 更新現有商品後，重新載入資料以更新快取
                try {
                    await this.loadData();
                } catch (err) {
                    console.warn('重新載入資料失敗:', err);
                }
                
                return { message: '商品已更新', quantity: newQuantity };
            } else {
                // 新增新行
                const maxIndex = Math.max(codeFieldIndex, nameFieldIndex, quantityFieldIndex);
                const newRow = new Array(maxIndex + 1).fill('');
                newRow[codeFieldIndex] = code;
                newRow[nameFieldIndex] = name || '未知商品';
                newQuantity = quantity !== null ? quantity : 1; // 新增商品時的數量
                if (quantityFieldIndex >= 0) {
                    newRow[quantityFieldIndex] = newQuantity;
                }

                const appendResponse = await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&access_token=${token}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            values: [newRow]
                        })
                    }
                );

                if (!appendResponse.ok) {
                    const errorData = await appendResponse.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || '新增商品失敗');
                }

                // 重新載入資料以更新快取
                try {
                    await this.loadData();
                } catch (err) {
                    console.warn('重新載入資料失敗:', err);
                }
                
                return { message: '商品已新增', quantity: newQuantity };
            }
        } catch (error) {
            console.error('更新 Google Sheets 失敗:', error);
            throw error;
        }
    }

    // 刪除商品（當數量為 0 時使用）
    async deleteItem(code) {
        try {
            const token = await this.getAccessToken();
            
            // 先讀取現有資料以找到行號
            const needsQuotes = /[\s\-'"]/.test(this.sheetName);
            const range = needsQuotes 
                ? `'${this.sheetName.replace(/'/g, "''")}'!A:Z` 
                : `${this.sheetName}!A:Z`;

            const readResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?access_token=${token}`
            );

            if (!readResponse.ok) {
                throw new Error('無法讀取工作表');
            }

            const readData = await readResponse.json();
            const rows = readData.values || [];

            if (rows.length === 0) {
                throw new Error('工作表為空');
            }

            const headers = rows[0] || ['條碼', '名稱', '價格', '數量'];
            const codeFields = ['條碼', 'Barcode', 'Code', 'code', 'barcode', '商品編號', 'ID'];
            const codeFieldIndex = headers.findIndex(h => codeFields.includes(h));
            
            if (codeFieldIndex === -1) {
                throw new Error('找不到條碼欄位');
            }

            // 搜尋要刪除的行
            let rowIndex = -1;
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][codeFieldIndex] || '').trim() === String(code).trim()) {
                    rowIndex = i + 1; // Google Sheets 從 1 開始
                    break;
                }
            }

            if (rowIndex === -1) {
                throw new Error('找不到要刪除的商品');
            }

            // 使用 batchUpdate 刪除整行
            const deleteRequest = {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: 0, // 默認使用第一個工作表
                            dimension: 'ROWS',
                            startIndex: rowIndex - 1, // 0-based index
                            endIndex: rowIndex // 刪除一行
                        }
                    }
                }]
            };

            // 先獲取工作表 ID
            const spreadsheetResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?access_token=${token}`
            );
            
            if (!spreadsheetResponse.ok) {
                throw new Error('無法獲取試算表資訊');
            }
            
            const spreadsheet = await spreadsheetResponse.json();
            const sheets = spreadsheet.sheets || [];
            const targetSheet = sheets.find(s => s.properties.title === this.sheetName);
            
            if (!targetSheet) {
                throw new Error(`找不到工作表: ${this.sheetName}`);
            }
            
            const sheetId = targetSheet.properties.sheetId;
            deleteRequest.requests[0].deleteDimension.range.sheetId = sheetId;

            // 執行刪除
            const deleteResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate?access_token=${token}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(deleteRequest)
                }
            );

            if (!deleteResponse.ok) {
                const error = await deleteResponse.json();
                throw new Error(error.error?.message || '刪除失敗');
            }

            // 重新載入資料以更新快取
            try {
                await this.loadData();
            } catch (err) {
                console.warn('重新載入資料失敗:', err);
            }

            return { message: '商品已刪除' };
        } catch (error) {
            console.error('刪除商品失敗:', error);
            throw error;
        }
    }

    // 將列索引轉換為字母
    getColumnLetter(columnIndex) {
        let result = '';
        while (columnIndex >= 0) {
            result = String.fromCharCode(65 + (columnIndex % 26)) + result;
            columnIndex = Math.floor(columnIndex / 26) - 1;
        }
        return result;
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
}

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleSheetsDirectAPI;
} else {
    window.GoogleSheetsDirectAPI = GoogleSheetsDirectAPI;
}

