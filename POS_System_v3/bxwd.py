import cv2
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
import numpy as np
import threading
import time
import json
import re
import traceback
import ssl
import os
from ultralytics import YOLO
from google import genai

# 修復 Mac SSL 下載問題
ssl._create_default_https_context = ssl._create_unverified_context

# --- 核心設定 ---
API_KEY = "AIzaSyB7wGDVXbkqUd8CZUT_Ugf4fCJBAtYioNA" 
client = genai.Client(api_key=API_KEY)
MODEL_ID = "gemini-2.5-flash-lite"
YOLO_MODEL_PATH = "yolo11n.pt"

class SmartFridgeV5_2:
    def __init__(self, window):
        self.window = window
        self.window.title("Smart Fridge POS v5.2 (Stability Fixed)")
        
        self.cap = cv2.VideoCapture(0)
        self.cam_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.cam_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        print("正在載入 YOLO 模型...")
        self.yolo = YOLO(YOLO_MODEL_PATH)
        
        self.poly_points = np.array([[150, 100], [490, 100], [490, 380], [150, 380]], dtype=np.float32)
        self.selected_point = None
        self.is_inside_prev = False
        self.is_identifying = False
        self.inventory = {}
        self.view_scale = 1.0
        self.off_x, self.off_y = 0, 0

        self.setup_ui()
        
        self.canvas.bind("<ButtonPress-1>", self.on_click)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)

        self.back_sub = cv2.createBackgroundSubtractorMOG2(history=50, varThreshold=50, detectShadows=False)
        self.update()

    def setup_ui(self):
        self.window.columnconfigure(0, weight=4)
        self.window.columnconfigure(1, weight=1)
        self.window.rowconfigure(0, weight=1)

        self.canvas = tk.Canvas(self.window, bg="black", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        self.sidebar = tk.Frame(self.window, width=300, bg="#f4f4f4", padx=15, pady=10)
        self.sidebar.grid(row=0, column=1, sticky="nsew")
        self.sidebar.grid_propagate(False)

        tk.Label(self.sidebar, text="📦 監控儀表板 v5.2", font=("Arial", 16, "bold"), bg="#f4f4f4").pack(pady=10)
        
        diag_frame = tk.LabelFrame(self.sidebar, text="即時診斷", bg="#f4f4f4", padx=5, pady=5)
        diag_frame.pack(fill=tk.X, pady=5)
        self.diag_label = tk.Label(diag_frame, text="系統就緒", wraplength=250, bg="#f4f4f4", fg="#333")
        self.diag_label.pack()

        tk.Label(self.sidebar, text="當前庫存:", font=("Arial", 10, "bold"), bg="#f4f4f4").pack(anchor="w")
        self.inv_text = tk.Text(self.sidebar, height=15, state=tk.DISABLED, font=("Arial", 11))
        self.inv_text.pack(fill=tk.BOTH, expand=True, pady=5)
        
        tk.Button(self.sidebar, text="清空庫存", command=self.clear_inv).pack(fill=tk.X)

    def get_img_coords(self, ex, ey):
        ix = (ex - self.off_x) / self.view_scale
        iy = (ey - self.off_y) / self.view_scale
        return ix, iy

    def on_click(self, event):
        ix, iy = self.get_img_coords(event.x, event.y)
        for i, pt in enumerate(self.poly_points):
            if np.linalg.norm(pt - [ix, iy]) < 20:
                self.selected_point = i
                break

    def on_drag(self, event):
        if self.selected_point is not None:
            ix, iy = self.get_img_coords(event.x, event.y)
            self.poly_points[self.selected_point] = [np.clip(ix, 0, self.cam_w), np.clip(iy, 0, self.cam_h)]

    def on_release(self, event):
        self.selected_point = None

    def clear_inv(self):
        self.inventory = {}
        self.update_inv_ui()

    def update_inv_ui(self):
        self.inv_text.config(state=tk.NORMAL)
        self.inv_text.delete('1.0', tk.END)
        for k, v in self.inventory.items():
            if v > 0: self.inv_text.insert(tk.END, f"• {k}: {v}\n")
        self.inv_text.config(state=tk.DISABLED)

    def identify_and_update(self, frame, action):
        self.is_identifying = True
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                self.diag_label.config(text=f"狀態: 正在通訊 ({action})...", fg="blue")
                _, buffer = cv2.imencode('.jpg', frame)
                
                # 更明確的 Prompt
                prompt = "辨識照片中物品名，回傳 JSON: {'brand': '品牌', 'product': '品名'}。若品牌未知請填 Unknown。"
                
                response = client.models.generate_content(
                    model=MODEL_ID,
                    contents=[prompt, genai.types.Part.from_bytes(data=buffer.tobytes(), mime_type="image/jpeg")]
                )
                
                res_text = response.text.strip()
                print(f"[DEBUG] Gemini 回傳: {res_text}")
                
                # 清洗 JSON 並解析
                cleaned_text = res_text.replace("'", '"')
                match = re.search(r'\{.*\}', cleaned_text, re.DOTALL)
                
                if match:
                    data = json.loads(match.group())
                    brand = data.get('brand', '') if data.get('brand') != 'Unknown' else ""
                    product = data.get('product', '未知物品')
                    full_name = f"{brand} {product}".strip()

                    if action == "PUT_IN":
                        self.inventory[full_name] = self.inventory.get(full_name, 0) + 1
                    else:
                        self.inventory[full_name] = max(0, self.inventory.get(full_name, 0) - 1)
                    
                    self.update_inv_ui()
                    self.diag_label.config(text=f"✅ 完成: {action}\n{full_name}", fg="green")
                    break # 成功則跳出重試迴圈
                else:
                    raise ValueError("無法從回傳內容提取 JSON")

            except Exception as e:
                error_short = str(e) # 確保定義 error_short
                print(f"[Error Log] 嘗試 {retry_count+1}: {error_short}")
                
                if "503" in error_short and retry_count < max_retries - 1:
                    retry_count += 1
                    self.diag_label.config(text=f"⚠️ 模型繁忙，重試中 ({retry_count})...", fg="orange")
                    time.sleep(2)
                    continue
                
                self.diag_label.config(text=f"❌ 錯誤: {error_short[:40]}", fg="red")
                break
        
        self.is_identifying = False

    def update(self):
        ret, frame = self.cap.read()
        if not ret: return

        yolo_results = self.yolo(frame, verbose=False, conf=0.35)[0]
        current_center = None
        
        for box in yolo_results.boxes:
            cls = int(box.cls[0])
            if cls in [0, 39, 41, 73, 67]: # 手, 瓶, 杯, 餐具, 手機等
                xyxy = box.xyxy[0].tolist()
                current_center = ((xyxy[0]+xyxy[2])/2, (xyxy[1]+xyxy[3])/2)
                # 畫出 YOLO 偵測框與中心點
                cv2.rectangle(frame, (int(xyxy[0]), int(xyxy[1])), (int(xyxy[2]), int(xyxy[3])), (255, 165, 0), 2)
                cv2.circle(frame, (int(current_center[0]), int(current_center[1])), 5, (0, 0, 255), -1)
                break

        if current_center:
            is_inside = cv2.pointPolygonTest(self.poly_points.astype(np.int32), current_center, False) >= 0
            
            if is_inside and not self.is_inside_prev:
                if not self.is_identifying:
                    threading.Thread(target=self.identify_and_update, args=(frame.copy(), "PUT_IN")).start()
            elif not is_inside and self.is_inside_prev:
                if not self.is_identifying:
                    threading.Thread(target=self.identify_and_update, args=(frame.copy(), "TAKE_OUT")).start()
            
            self.is_inside_prev = is_inside

        pts = self.poly_points.astype(np.int32)
        overlay = frame.copy()
        cv2.fillPoly(overlay, [pts], (0, 255, 0))
        cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
        for p in pts: cv2.circle(frame, tuple(p), 8, (0, 0, 255), -1)

        can_w, can_h = self.canvas.winfo_width(), self.canvas.winfo_height()
        if can_w > 1:
            self.view_scale = min(can_w/self.cam_w, can_h/self.cam_h)
            nw, nh = int(self.cam_w*self.view_scale), int(self.cam_h*self.view_scale)
            self.off_x, self.off_y = (can_w-nw)/2, (can_h-nh)/2
            
            resized = cv2.resize(frame, (nw, nh))
            self.photo = ImageTk.PhotoImage(image=Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)))
            self.canvas.delete("all")
            self.canvas.create_image(can_w/2, can_h/2, image=self.photo)
            
        self.window.after(30, self.update)

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("1150x750")
    app = SmartFridgeV5_2(root)
    root.mainloop()