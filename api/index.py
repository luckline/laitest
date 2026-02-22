from flask import Flask, jsonify

# 变量名必须叫 app
app = Flask(__name__)

@app.route('/api/test')
def test():
    return jsonify({
        "status": "success", 
        "message": "Flask is running on laitest.tech"
    })

# 专门为 Vercel 做的根路径兼容
@app.route('/api/')
def api_home():
    return "Laitest API Index"

# ！！！重点：删除之前可能写的 handler = app ！！！
# 如果报错持续，Vercel 默认寻找的是 app 变量。
