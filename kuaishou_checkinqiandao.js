/*
 * 快手自动签到脚本
 * 适用于 QuantumultX
 */

const $ = new Env("快手签到");

(async () => {
    const cookieData = $.getdata('kuaishou_cookie');
    
    if (!cookieData) {
        $.msg($.name, '签到失败 ❌', '未获取到Cookie，请先打开快手APP触发Cookie获取');
        $.done();
        return;
    }
    
    const cookie = JSON.parse(cookieData);
    
    try {
        await checkin(cookie);
    } catch (error) {
        $.msg($.name, '签到异常 ❌', error.message);
    }
    
    $.done();
})();

async function checkin(cookie) {
    return new Promise((resolve) => {
        const url = 'https://nebula.kuaishou.com/rest/n/nebula/sign';
        
        const headers = {
            'Cookie': cookie.fullCookie,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            'Referer': 'https://nebula.kuaishou.com/nebula/task/earning',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        };
        
        const request = {
            url: url,
            headers: headers,
            body: JSON.stringify({})
        };
        
        $.post(request, (error, response, data) => {
            try {
                if (error) {
                    $.msg($.name, '签到失败 ❌', `网络错误: ${error}`);
                } else {
                    const result = JSON.parse(data);
                    
                    if (result.result === 1) {
                        const reward = result.data.toast || '签到成功';
                        $.msg($.name, '签到成功 ✅', reward);
                    } else if (result.result === 101006) {
                        $.msg($.name, '今日已签到 ✅', '明天继续哦~');
                    } else {
                        $.msg($.name, '签到失败 ❌', result.error_msg || '未知错误');
                    }
                }
            } catch (e) {
                $.msg($.name, '签到解析失败 ❌', e.message);
            }
            resolve();
        });
    });
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
    
    this.post = (options, callback) => {
        $httpClient.post(options, callback);
    };
    
    this.done = () => {
        $done({});
    };
}
