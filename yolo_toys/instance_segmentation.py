from ultralytics import YOLO
import cv2
import os

def run_instance_segmentation(source=0):
    """
    Run YOLO Instance Segmentation on a given source.
    Source can be:
    - 0 or 1: Web cam
    - path/to/video.mp4: Video file
    - path/to/image.jpg: Image file
    """
    # Load a pre-trained YOLOv8 segmentation model
    # Options: yolov8n-seg.pt, yolov8s-seg.pt, yolov8m-seg.pt, yolov8l-seg.pt, yolov8x-seg.pt
    model = YOLO('yolov8n-seg.pt')

    # Run inference
    # stream=True uses a generator for memory efficiency on long videos
    results = model.predict(source=source, stream=True, show=True, conf=0.5)

    print(f"Starting instance segmentation on: {source}")
    print("Press 'q' to stop if window is visible.")

    for r in results:
        # Each 'r' is a Results object
        # It contains boxes, masks, keypoints, etc.
        # Since show=True is passed to predict, a window will pop up
        
        # If the window is closed or 'q' is pressed, break
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cv2.destroyAllWindows()

if __name__ == "__main__":
    # Default to webcam (0)
    # You can change this to an image path or video path
    user_source = input("Enter source (0 for webcam, or path to image/video) [Default: 0]: ") or "0"
    
    # Try to convert to int if it's a number (for webcam)
    try:
        source_val = int(user_source)
    except ValueError:
        source_val = user_source
        if not os.path.exists(source_val):
            print(f"Error: File {source_val} not found.")
            exit()

    run_instance_segmentation(source=source_val)
