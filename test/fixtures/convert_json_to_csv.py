import json
import csv


with open("./compatibility-heatmap-2026.json", "r", encoding="utf-8") as f:
    data = json.load(f)


with open("./compatibility-heatmap-2026.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerows(data)


print("Converted successfully")