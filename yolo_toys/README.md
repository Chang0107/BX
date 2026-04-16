# YOLO Toys

這個資料夾提供 5 個對應備忘錄主題的 YOLO 小專案：

1. `object_counting.py` - 區域計數（穿越中線計數）
2. `object_tracking.py` - 物體追蹤
3. `instance_segmentation.py` - 實例分割
4. `image_classification.py` - 影像分類
5. `oriented_bounding_boxes.py` - 旋轉框偵測（OBB）

## 安裝

```bash
python -m pip install ultralytics opencv-python lap
```

## 執行方式

在 `yolo_toys` 目錄中執行：

```bash
python object_counting.py
python object_tracking.py
python instance_segmentation.py
python image_classification.py
python oriented_bounding_boxes.py
```

每支程式都可輸入：

- `0`：使用 webcam
- 影像路徑：例如 `test.jpg`
- 影片路徑：例如 `test.mp4`

也可指定模型權重（預設如下）：

- 計數/追蹤：`yolov8n.pt`
- 分割：`yolov8n-seg.pt`
- 分類：`yolov8n-cls.pt`
- OBB：`yolov8n-obb.pt`

> 若本機沒有對應權重，Ultralytics 會自動下載。

## Multi-Object Tracking（BoT-SORT / ByteTrack）

`object_tracking.py` 與 `object_counting.py` 都支援選擇追蹤器：

- `bytetrack`（預設）
- `botsort`

執行時會詢問：

```text
Tracker (bytetrack/botsort) [Default: bytetrack]:
```

在 `object_counting.py` 還有防重複計數選項：

```text
Count each ID only once per direction? (y/n) [Default: y]:
```

建議維持 `y`，可減少遮擋後 ID 短暫波動造成的重複計數。

## 常見錯誤排除

- 模型副檔名要用 `.pt`，不是 `.py`（例如 `yolov8n.pt`）
- 若出現 `pip: command not found`，請改用：`python -m pip install <package>`
- 若出現 `ModuleNotFoundError: No module named 'lap'`，執行：`python -m pip install lap`
- 若出現 SSL 下載失敗，通常是本機 Python 憑證問題；可先手動下載權重放到本資料夾，再指定模型檔名執行
