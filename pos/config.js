// 系統配置文件
// 此文件包含默認配置，網頁打開時會自動使用這些配置

// 系統配置文件
// 此配置已測試並正常工作
// Google Sheets: https://docs.google.com/spreadsheets/d/1CDsLiprgdCu0ZjUpobEjJe8KSlbqIljBHR9NAhBnzAQ/edit

const SYSTEM_CONFIG = {
    // 默認資料庫模式：'local' = 本地模式（快速，離線運行）, 'sheets' = Google Sheets 模式
    defaultDatabaseMode: 'local',
    
    // 默認使用直接模式（無需後端服務器）- 僅在 Google Sheets 模式時使用
    defaultMode: 'direct',
    
    // Google Spreadsheet ID（從 Google Sheets 網址中取得）
    // 當前使用的試算表：https://docs.google.com/spreadsheets/d/1CDsLiprgdCu0ZjUpobEjJe8KSlbqIljBHR9NAhBnzAQ/edit
    defaultSpreadsheetId: '1CDsLiprgdCu0ZjUpobEjJe8KSlbqIljBHR9NAhBnzAQ',
    
    // 默認工作表名稱
    defaultSheetName: 'Sheet1',
    
    // 後端模式時的 API 地址（如果使用後端模式）
    defaultApiUrl: 'http://localhost:3000/api',
    
    // 是否自動連接（true = 網頁打開時自動連接）- 僅在 Google Sheets 模式時使用
    autoConnect: true,
    
    // 服務帳戶憑證文件路徑
    serviceAccountPath: 'service-account-key.json',
    
    // 服務帳戶郵件（用於添加到 Google Sheets 共用設定）
    serviceAccountEmail: 'clockcalendar@triple-router-476115-k6.iam.gserviceaccount.com',
    
    // 欄位配置（當前 Google Sheets 的欄位順序）
    fields: {
        code: '條碼',        // 第 1 欄：條碼
        name: '名稱',        // 第 2 欄：名稱
        price: '價格',       // 第 3 欄：價格
        quantity: '數量'     // 第 4 欄：數量
    }
};

// 如果配置存在，自動使用
if (typeof window !== 'undefined') {
    window.SYSTEM_CONFIG = SYSTEM_CONFIG;
}

