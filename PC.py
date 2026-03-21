import cv2
import threading
import queue
import time
import sys
import os
import itertools
import google.generativeai as genai
from ultralytics import YOLO
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import socketio

# ==========================================
# 設定區
# ==========================================
# Gemini API Key：可填多組，遇 429 / 額度不足時會依序輪替同一模型；全部 Key 都失敗後才切換下一個模型。
# 亦可改用環境變數（優先於下列列表）：
#   - GEMINI_API_KEYS=key1,key2,key3
#   - 或 GEMINI_API_KEY=單一 key
API_KEYS = [
    "AIzaSyB-VKaV6mTs6T2gG2V3nMKkNgtDXWgUlMA",  # 第一組 Key（請填入）
    "AIzaSyDGZDVoppPMBHn3_0kjQDSJwH4Hisw8Frg",  # 第二組（選填）
    # "",  # 更多組…
]

YOLO_MODEL_NAME = 'yolo11n.pt' 
FONT_PATH = "C:/Windows/Fonts/msjh.ttc" 
FONT_SIZE = 30 
NODE_SERVER_URL = "http://localhost:3000"

STABILITY_FRAMES = 20   # [調整] 增加到 20，確保物體真的停住才辨識
MAX_RPM = 5             # [調整] 大幅降低到 5，避免瞬間爆額度
MAX_MISSING_FRAMES = 30 

CANDIDATE_MODELS = [
    "gemini-2.0-flash-exp",
    "gemini-exp-1206",
    "gemini-2.0-flash-lite-preview-02-05",
    "gemini-2.0-flash-lite-preview",
    "gemini-2.5-flash-lite-preview-09-2025",
    "gemini-2.5-flash",  
    "gemini-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b"
]

# ==========================================


def _resolve_gemini_api_keys():
    """環境變數優先，否則使用上方 API_KEYS 列表（略過空字串）。"""
    env_multi = os.environ.get("GEMINI_API_KEYS", "").strip()
    if env_multi:
        return [k.strip() for k in env_multi.split(",") if k.strip()]
    env_single = os.environ.get("GEMINI_API_KEY", "").strip()
    if env_single:
        return [env_single]
    return [str(k).strip() for k in API_KEYS if str(k).strip()]


RESOLVED_GEMINI_KEYS = _resolve_gemini_api_keys()
if not RESOLVED_GEMINI_KEYS:
    print("❌ 錯誤：請在 PC.py 的 API_KEYS 填入至少一組 Key，或設定環境變數 GEMINI_API_KEY / GEMINI_API_KEYS")
    exit()


class Spinner:
    def __init__(self, message="處理中"):
        self.message = message
        self.stop_running = False
        self.thread = threading.Thread(target=self._animate, daemon=True)

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.stop()

    def start(self):
        self.stop_running = False
        self.thread.start()

    def stop(self):
        self.stop_running = True
        self.thread.join()
        sys.stdout.write('\r' + ' ' * (len(self.message) + 10) + '\r')
        sys.stdout.flush()

    def _animate(self):
        chars = itertools.cycle(['-', '\\', '|', '/'])
        for char in chars:
            if self.stop_running:
                break
            sys.stdout.write(f'\r{self.message} {char} ')
            sys.stdout.flush()
            time.sleep(0.1)

# ==========================================

class SmartVisionSystem:
    def __init__(self):
        print("=== 系統初始化 ===")
        self.lock = threading.Lock()
        self.object_database = {}
        self.task_queue = queue.Queue()
        self.api_history = []
        
        self.is_running = True
        self.sio = socketio.Client(logger=False, engineio_logger=False)
        self.is_connected = False
        # [新增] 監聽重置請求
        self.sio.on('request_resync', self.on_resync_request)
        
        self.connect_to_server()

        # 多組 API Key（額度不足時輪替）
        self.api_keys = list(RESOLVED_GEMINI_KEYS)
        self.current_key_index = 0
        try:
            genai.configure(api_key=self.api_keys[self.current_key_index])
            print(f"🔑 已載入 {len(self.api_keys)} 組 Gemini API Key（遇額度問題將依序切換）")
        except Exception as e:
            print(f"❌ API Key 設定錯誤: {e}")
            self.is_running = False
            return
        
        print("正在過濾無效模型 (去除 404)...")
        self.valid_models = self.filter_valid_models()
        
        if not self.valid_models:
            print("❌ 嚴重錯誤：找不到任何合法的 Gemini 模型名稱！")
            self.is_running = False
            return
            
        self.current_model_index = 0
        self.model_name = self.valid_models[0]
        self.gemini_model = genai.GenerativeModel(self.model_name)
        print(f"👉 初始模型: {self.model_name}")
        
        with Spinner(f"正在載入 YOLO 模型 ({YOLO_MODEL_NAME})..."):
            self.yolo_model = YOLO(YOLO_MODEL_NAME)
        print(f"✅ YOLO 模型載入完成: {YOLO_MODEL_NAME}")
        
        self.gemini_thread = threading.Thread(target=self.gemini_worker, daemon=True)
        self.gemini_thread.start()
        
        print("✅ 系統啟動成功！")

    def connect_to_server(self):
        try:
            print(f"正在連線到伺服器 {NODE_SERVER_URL} ...")
            self.sio.connect(NODE_SERVER_URL)
            self.is_connected = True
            print("✅ Socket.IO 連線成功！")
            self.sio.emit('register_detector')
        except Exception as e:
            print(f"⚠️ 無法連線到伺服器: {e}")
            print("   (將在背景持續嘗試連線...)")
            threading.Thread(target=self.retry_connection, daemon=True).start()

    def retry_connection(self):
        while not self.is_connected and self.is_running:
            time.sleep(5)
            try:
                self.sio.connect(NODE_SERVER_URL)
                self.is_connected = True
                print("\n✅ Socket.IO 重連成功！")
                self.sio.emit('register_detector')
            except:
                pass

    def on_resync_request(self):
        print("\n [指令] 收到重置請求，正在重新發送畫面物件...")
        with self.lock:
            for track_id, data in self.object_database.items():
                if data["status"] == "done" and data["gemini_name"] and "失敗" not in data["gemini_name"]:
                    try:
                        payload = {
                            "name": data["gemini_name"],
                            "quantity": 1,
                            "isAutoMode": False 
                        }
                        self.sio.emit('detect_item', payload)
                        print(f" 📤 [重送] {data['gemini_name']}")
                    except:
                        pass

    def filter_valid_models(self):
        valid_list = []
        for name in CANDIDATE_MODELS:
            print(f"  檢查: {name:<35} ... ", end="")
            try:
                temp_model = genai.GenerativeModel(name)
                temp_model.generate_content("Hi")
                print("✅ 可用")
                valid_list.append(name)
            except Exception as e:
                err = str(e)
                if "404" in err:
                    print("❌ 不存在 (跳過)")
                else:
                    print("⚠️ 額度滿但存在 (保留)")
                    valid_list.append(name)
        return valid_list

    @staticmethod
    def _is_quota_or_rate_limit_error(err_msg: str) -> bool:
        """判斷是否為額度 / 限速類錯誤（可觸發換 Key 或換模型）。"""
        u = err_msg.upper()
        return (
            "429" in err_msg
            or "RESOURCE_EXHAUSTED" in u
            or "QUOTA" in u
            or "RATE LIMIT" in u
            or "RATE_LIMIT" in u
            or "TOO MANY REQUESTS" in u
        )

    def apply_current_api_key(self):
        """使用目前索引的 Key 重新 configure，並以目前 model_name 重建 GenerativeModel。"""
        genai.configure(api_key=self.api_keys[self.current_key_index])
        self.gemini_model = genai.GenerativeModel(self.model_name)

    def rotate_next_api_key(self):
        """切換到下一組 API Key 並套用。若只有一組 Key 則不變。"""
        if len(self.api_keys) <= 1:
            return
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
        self.apply_current_api_key()
        print(f"\n🔑 已切換至第 {self.current_key_index + 1}/{len(self.api_keys)} 組 API Key")

    def switch_next_model(self):
        self.current_model_index = (self.current_model_index + 1) % len(self.valid_models)
        self.model_name = self.valid_models[self.current_model_index]
        self.gemini_model = genai.GenerativeModel(self.model_name)
        print(f"\n🔄 切換模型 -> {self.model_name}")

    def gemini_worker(self):
        while self.is_running:
            try:
                task = self.task_queue.get(timeout=0.1)
                track_id, cropped_img, current_yolo_name = task
                
                with self.lock:
                    if track_id not in self.object_database:
                        continue

                print(f" >> [Gemini] 正在辨識 ID:{track_id} ({current_yolo_name})...")
                
                img_rgb = cv2.cvtColor(cropped_img, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(img_rgb)
                
                prompt = f"""
                這張圖透過 YOLO 偵測為「{current_yolo_name}」。
                1. 請辨識品牌或產品名稱 (例如: 路易莎咖啡, iPhone 15)。
                2. 若無品牌，請回答物品名稱。
                3. 用繁體中文，只要名稱。
                """
                
                max_retries = len(self.valid_models)
                attempts = 0
                product_name = "辨識失敗"
                # 同一模型下，已因額度問題輪替過幾次 Key（輪完一輪仍失敗才換模型）
                quota_key_rotations = 0
                
                while attempts < max_retries:
                    try:
                        # [新增] 每次呼叫 API 前，先檢查是否過快
                        if not self.check_api_quota():
                            print(" ⏳ API 呼叫過快，暫停 5 秒...")
                            time.sleep(5)
                            
                        response = self.gemini_model.generate_content([prompt, pil_img])
                        product_name = response.text.strip()
                        # 記錄成功呼叫時間
                        self.api_history.append(time.time())
                        break
                        
                    except Exception as api_err:
                        err_msg = str(api_err)

                        if self._is_quota_or_rate_limit_error(err_msg):
                            short = err_msg[:300] + ("..." if len(err_msg) > 300 else "")
                            print(f" !! [API 額度/限速] {short}")
                            time.sleep(2)

                            if len(self.api_keys) > 1:
                                self.rotate_next_api_key()
                                quota_key_rotations += 1
                                if quota_key_rotations >= len(self.api_keys):
                                    # 所有 Key 在此模型上都失敗，改換下一個模型，並從第一組 Key 重試
                                    quota_key_rotations = 0
                                    attempts += 1
                                    print(" !! 所有 API Key 皆額度不足，改切換模型並從第一組 Key 重試...")
                                    self.current_key_index = 0
                                    genai.configure(api_key=self.api_keys[0])
                                    time.sleep(3)
                                    self.switch_next_model()
                                continue
                            else:
                                attempts += 1
                                time.sleep(3)
                                self.switch_next_model()
                                continue

                        attempts += 1
                        print(f" !! [API Error] {err_msg}")
                        product_name = "API錯誤"
                        break

                with self.lock:
                    if track_id in self.object_database:
                        self.object_database[track_id]["gemini_name"] = product_name
                        self.object_database[track_id]["status"] = "done"
                
                print(f" << [Gemini] ID:{track_id} 結果: {product_name}")
                
                if self.is_connected and product_name and "失敗" not in product_name and "錯誤" not in product_name:
                    try:
                        payload = {
                            "name": product_name,
                            "quantity": 1,
                            "isAutoMode": False 
                        }
                        self.sio.emit('detect_item', payload)
                        print(f" 📤 [發送成功] 已傳送 '{product_name}' 給伺服器")
                    except Exception as e:
                        print(f" ⚠️ 發送失敗: {e}")
                        self.is_connected = False
                        threading.Thread(target=self.retry_connection, daemon=True).start()
                
            except queue.Empty:
                continue
            except Exception as e:
                print(f"System Error: {e}")

    def check_api_quota(self):
        current_time = time.time()
        # 清除 60 秒以前的記錄
        self.api_history = [t for t in self.api_history if current_time - t < 60]
        # 檢查是否超過上限
        return len(self.api_history) < MAX_RPM

    def draw_chinese_text(self, img, text, position, color=(0, 255, 0)):
        img_pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img_pil)
        try:
            font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
        except IOError:
            font = ImageFont.load_default()
        x, y = position
        outline_color = (0,0,0)
        for adj in [(-1,0), (1,0), (0,-1), (0,1)]:
            draw.text((x+adj[0], y+adj[1]), text, font=font, fill=outline_color)
        draw.text(position, text, font=font, fill=color)
        return cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)

    def process_frame(self, frame):
        results = self.yolo_model.track(frame, persist=True, tracker="bytetrack.yaml", conf=0.5, verbose=False)
        current_frame_ids = set()
        
        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.int().cpu().numpy()
            cls_ids = results[0].boxes.cls.int().cpu().numpy() 
            names = results[0].names 

            for box, track_id, cls_id in zip(boxes, track_ids, cls_ids):
                current_frame_ids.add(track_id)
                x1, y1, x2, y2 = map(int, box)
                yolo_raw_name = names[cls_id] 
                
                with self.lock:
                    if track_id not in self.object_database:
                        self.object_database[track_id] = {
                            "yolo_name": yolo_raw_name,   
                            "gemini_name": "",            
                            "status": "pending",
                            "frame_count": 0,
                            "missing_count": 0
                        }
                    self.object_database[track_id]["missing_count"] = 0
                    self.object_database[track_id]["frame_count"] += 1
                    obj_data = self.object_database[track_id]
                
                # [核心優化] 只有累積超過 20 幀 (STABILITY_FRAMES) 才發送 API
                # 而且在檢查額度前，確保狀態是 pending
                if obj_data["status"] == "pending" and obj_data["frame_count"] > STABILITY_FRAMES:
                    if self.check_api_quota():
                        # [新增] 確保物體夠大才辨識 (避免背景雜訊)
                        if (x2 - x1) > 80 and (y2 - y1) > 80:
                            self.api_history.append(time.time()) # 先佔位
                            with self.lock:
                                self.object_database[track_id]["status"] = "sending"
                                self.object_database[track_id]["gemini_name"] = "Thinking..."
                            
                            h, w, _ = frame.shape
                            crop_img = frame[max(0,y1):min(h,y2), max(0,x1):min(w,x2)]
                            self.task_queue.put((track_id, crop_img, yolo_raw_name))
                    else:
                         # 額度滿了就先不送，維持 pending，下一幀再試
                         pass

                gemini_res = self.object_database[track_id]["gemini_name"]
                yolo_res = self.object_database[track_id]["yolo_name"]
                
                if gemini_res == "":
                    display_text = f"YOLO: {yolo_res}"
                    color = (255, 100, 0)
                elif "Thinking" in gemini_res:
                    display_text = f"{yolo_res} ({gemini_res})"
                    color = (0, 255, 255)
                elif "額度" in gemini_res or "失敗" in gemini_res:
                    display_text = f"{yolo_res} ({gemini_res})"
                    color = (0, 0, 255)
                else:
                    display_text = f"{gemini_res}"
                    color = (0, 255, 0)
                
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                label = f"ID:{track_id} {display_text}"
                frame = self.draw_chinese_text(frame, label, (x1, y1 - 35), color)

        with self.lock:
            existing_ids = list(self.object_database.keys())
            for db_id in existing_ids:
                if db_id not in current_frame_ids:
                    self.object_database[db_id]["missing_count"] += 1
                    if self.object_database[db_id]["missing_count"] > MAX_MISSING_FRAMES:
                        product_name = self.object_database[db_id]["gemini_name"]
                        if self.is_connected and product_name and "Thinking" not in product_name and "失敗" not in product_name:
                            try:
                                payload = {
                                    "name": product_name,
                                    "quantity": 1,
                                    "action": "REMOVE" 
                                }
                                self.sio.emit('detect_item', payload)
                                print(f" 🗑️ [已移除] {product_name} (-1)")
                            except:
                                pass
                        
                        print(f" 🗑️ ID:{db_id} 已移除 (離開畫面)")
                        del self.object_database[db_id]

        return frame

    def run(self):
        if not self.is_running: return 
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("錯誤：無法開啟攝影機 (ID: 0)")
            cap = cv2.VideoCapture(1)
            if not cap.isOpened():
                print("錯誤：無法開啟攝影機 (ID: 1)")
                return

        print("=== 畫面啟動 (Client 模式) ===")
        print("按 'q' 鍵離開程式")
        try:
            while True:
                success, frame = cap.read()
                if not success: break
                processed_frame = self.process_frame(frame)
                cv2.imshow("Smart Vision System (Client)", processed_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    self.is_running = False
                    break
        except KeyboardInterrupt:
            self.is_running = False
        cap.release()
        cv2.destroyAllWindows()
        if self.is_connected:
            self.sio.disconnect()
        print("程式已結束")

if __name__ == "__main__":
    app = SmartVisionSystem()
    app.run()