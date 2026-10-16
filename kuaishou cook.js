/*
 * 快手 Cookie 获取脚本
 * 用于捕获快手签到所需的 Cookie 信息
 */

const $ = new Env("快手Cookie获取");

if ($request && $request.method !== 'OPTIONS') {
    try {
        const headers = $request.headers;
        const cookie = headers['Cookie'] || headers['cookie'];
        
        if (cookie) {
            // 提取关键参数
            const apiSt = cookie.match(/kuaishou\.api_st=([^;]+)/);
            const did = cookie.match(/did=([^;]+)/);
            
            let kuaishouCookie = {};
            
            if (apiSt) kuaishouCookie.api_st = apiSt<i class="markdown-ref custom">1</i>;
            if (did) kuaishouCookie.did = did<i class="markdown-ref custom">1</i>;
            
            // 保存完整的 cookie 以备不时之需
            kuaishouCookie.fullCookie = cookie;
            
            if (kuaishouCookie.api_st) {
                $.setdata(JSON.stringify(kuaishouCookie), 'kuaishou_cookie');
                $.msg($.name, '获取Cookie成功 ✅', `api_st: ${kuaishouCookie.api_st.substring(0, 10)}...`);
            } else {
                $.msg($.name, '获取Cookie失败 ❌', '未找到 api_st，请确保已登录快手APP');
            }
        }
    } catch (error) {
        $.msg($.name, '获取Cookie异常 ❌', error.message);
    }
}

$.done();

// 通用 Env 类（简化版）
function Env(name) {
    this.name = name;
    
    this.getdata = (key) => {
        try {
            return JSON.parse($persistentStore.read(key));
        } catch {
            return $persistentStore.read(key);
        }
    };
    
    this.setdata = (value, key) => {
        if (typeof value === 'object') {
            $persistentStore.write(JSON.stringify(value), key);
        } else {
            $persistentStore.write(value, key);
        }
    };
    
    this.msg = (title, subtitle, body) => {
        $notify(title, subtitle, body);
    };
    
    this.done = () => {
        $done({});
    };
}
