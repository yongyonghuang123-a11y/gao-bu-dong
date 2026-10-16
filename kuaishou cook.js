/*
 * 快手 Cookie 获取脚本 - 重写版本
 * 用于拦截快手请求并提取 Cookie
 */

const $ = new Env("快手Cookie");

// 判断是否是重写请求
if (typeof $request !== "undefined") {
    getCookie();
} else {
    $.done();
}

function getCookie() {
    const headers = $request.headers;
    const cookie = headers['Cookie'] || headers['cookie'];
    
    if (!cookie) {
        $.msg($.name, '未获取到Cookie ❌', '请确保已登录快手APP');
        $.done();
        return;
    }
    
    try {
        // 提取关键参数
        const apiSt = cookie.match(/kuaishou\.api_st=([^;]+)/);
        const did = cookie.match(/did=([^;]+)/);
        
        let kuaishouCookie = {
            fullCookie: cookie
        };
        
        if (apiSt) kuaishouCookie.api_st = apiSt<i class="markdown-ref custom">1</i>;
        if (did) kuaishouCookie.did = did<i class="markdown-ref custom">1</i>;
        
        // 保存到持久化存储
        $.setdata(JSON.stringify(kuaishouCookie), 'kuaishou_cookie');
        
        const maskedSt = kuaishouCookie.api_st 
            ? kuaishouCookie.api_st.substring(0, 10) + '...'
            : '未获取到';
        
        $.msg($.name, '获取Cookie成功 ✅', `api_st: ${maskedSt}`);
        
    } catch (error) {
        $.msg($.name, '获取Cookie失败 ❌', error.message);
    }
    
    // 放行请求，不影响正常使用
    $.done({});
}

// 通用 Env 类
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
    
    this.done = (obj) => {
        if (obj) {
            $done(obj);
        } else {
            $done({});
        }
    };
}
