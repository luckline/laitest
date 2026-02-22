from flask import Flask

# 变量名必须叫 app，这是 Vercel 的默认寻找对象
app = Flask(__name__)

@app.route('/')
def home():
    return "Laitest Tech Python API is Live!"

@app.route('/api/test')
def test():
    return {"status": "success", "message": "Backend connected"}

# 关键修复：显式导出，防止 Vercel 运行时识别失败
# 在文件最底部添加这一行
handler = app
