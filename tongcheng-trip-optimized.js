/**
*
* hostname = app.17u.cn
*
* 同程旅行签到 - 优化版 v3 (基于 chavyleung/scripts tongcheng-trip.js)
*
*
* v4 改动（针对 2026-11-26 原版实测：签到失败、本月签到 0 天、今日 +55 里程）：
* 1. 原版只做 state=1 的任务，state=2 进行中和 state=3 待领取的任务它根本不碰，
*    v3 本来就比原版多做这两类；v4 保留。所以原版拿的比 v3 少，不是比 v3 多。
* 2. 每个任务多打一行原始数据日志，并按任务列表里的里程字段估算今日上限，
*    跑一次就能看到每天最多能拿多少、哪个字段是里程数。
* 3. 通知里写明签到失败的具体原因（code + message）和今日估算上限。
* 4. 签到 5000 已连续 3 天，不是偶发；脚本签到被服务端拒绝时只能 App 手动签到，
*    手动签到能重启连续签到天数。
* v3 改动（针对 2026-11-23 19:46 实测日志）：
*  日志证明：所有 finish 失败的任务都是 taskType=13，标题全是去XX领现金或红包
*  （快影、百度地图、芒果TV、微博等），start 能拿到实例 id，但 finish 一律报任务类型错误。
*  这类任务要服务端校验真实跳转第三方 App 的行为，光调 finish 永远过不了，
*  不是参数问题，任何脚本都做不了，直接跳过，不再浪费每次 15 秒等待和 240 秒总预算。
*  state 3 的点淘和开盲盒领奖报任务状态不对，说明已领过或状态异常，同样跳过。
*  另外修了一个通知 bug：之前通知里的签到天数和里程数字丢了，是因为代码里用了
*  全角方括号，被写文件时吞掉了；v3 改成普通文字，不再用全角方括号。
* v2 改动（针对 2026-11-23 实测日志）：
* 1. 5000 是服务端业务错误（“任务状态不对”“任务类型错误”“SERVER ERROR”），
* 同一个请求重试多少次结果都一样 —— v2 只对无响应/网络失败重试，5000 直接
* 记录原因跳过，不再烧 3 次重试。之前 35 个任务 × 3 次重试纯属浪费时间。
* 2. state 3（已完成）的任务不再调 finish，只调一次 receive；receive 也报
* “任务状态不对”就说明已领过或状态异常，直接跳过。
* 3. finish 请求体加上 taskCode：{id, taskCode}。服务端报“任务类型错误”
* 很可能就是 finish 认不出只带 id 的调用；多带一个字段一般会被忽略，
* 缺了却可能直接拒绝。
* 4. start 返回的实例 id 解析不到时，不再悄悄用列表 id 顶替 —— 会把原始
* 返回打到日志里，方便定位到底是哪个字段。
* 5. 每个任务多打一行详情日志（taskCode / state / taskType / browserTime /
* id），再跑一次把日志截图发我，就能精确定位是哪类任务过不了。
* 6. 签到 5000 时 5 秒后重试一次；还失败就是服务端问题，当天请在 App 里
* 手动签到一次保住连续签到，脚本不再撞接口。
*
* v1 的修复仍保留：state 0/1/2/3 分流、0 秒任务也处理、浏览多等 3 秒、
* 任务按时长从短到长、总耗时 240 秒上限、请求头清洗、抓包无 apptoken 不覆盖。
*
* # Surge
*
* http-request ^https:\/\/app\.17u\.cn\/welfarecenter\/index\/signIndex
* script-path=<你的脚本地址>, tag=同程旅行
*
* cron "5 12 * * *" script-path=<你的脚本地址>, timeout=600, tag=同程旅行-签到
*
* # QuanX
*
* ^https:\/\/app\.17u\.cn\/welfarecenter\/index\/signIndex url script-request-header
* <你的脚本地址>
*
* 5 12 * * * <你的脚本地址>, tag=同程旅行-签到
*
* # Loon
*
* http-request ^https:\/\/app\.17u\.cn\/welfarecenter\/index\/signIndex
* script-path=<你的脚本地址>, tag=同程旅行
*
* cron "5 12 * * *" script-path=<你的脚本地址>, timeout=600, tag=同程旅行-签到
*
* # 获取方式: 打开同程旅行 APP → 领福利，命中 signIndex 请求后自动保存请求头（含 phone、apptoken、device）
* # Token 失效时重新在 APP 领福利页点一次签到即可更新。
*/

const $ = new Env('同程旅行')

const BASE_URL = 'https://app.17u.cn/welfarecenter'
const KEY_SIGNHEADER = 'tongcheng_trip_signheader'
// QX 定时任务默认超时 300 秒，留出余量，内部总预算 240 秒
const MAX_RUNTIME_MS = 240000
const START_MS = Date.now()
const elapsedMs = () => Date.now() - START_MS

function getTodayDate() {
return $.time('yyyy-MM-dd')
}

// 发请求前清洗抓包存下来的请求头：去掉会随 body 变化的字段，只留鉴权关键字段
function cleanHeaders(headers) {
const out = {}
const drop = new Set([
'content-length', 'content-type', 'host', 'connection',
'accept-encoding', 'accept-length', 'content-encoding'
])
for (const k of Object.keys(headers || {})) {
if (drop.has(k.toLowerCase())) continue
out[k] = headers[k]
}
return out
}

function postApi(path, body, headers, label) {
return new Promise((resolve) => {
const opts = {
url: path.startsWith('http')? path: BASE_URL + path,
headers: {...cleanHeaders(headers), 'content-type': 'application/json'},
body: typeof body === 'object'? JSON.stringify(body || {}): body || '{}',
timeout: 15000
}
$.post(opts, (err, resp, data) => {
if (err) {
$.log(`[${label || path}] 请求失败: ${err}`)
resolve(null)
return
}
try {
const parsed = data? JSON.parse(data): null
if (parsed && parsed.code!== 2200) {
$.log(`[${label || path}] 返回 code=${parsed.code} message=${parsed.message || ''}`)
}
resolve(parsed)
} catch (e) {
$.logErr(e, data)
resolve(null)
}
})
})
}

// 只对无响应（网络/解析失败）重试一次；服务端已返回 code（含 5000）绝不重试，
// 同一个请求再发几次结果也一样，只会浪费时间和重试额度
async function postApiRetry(path, body, headers, label, retries = 1) {
for (let i = 0; i <= retries; i++) {
const res = await postApi(path, body, headers, label)
if (res) return res
if (i < retries) {
$.log(`[${label || path}] 第 ${i + 1} 次无响应，3 秒后重试`)
await $.wait(3000)
}
}
return null
}

// start 返回的实例 id 可能是字符串，也可能是对象里的某个字段
function parseInstanceId(data) {
if (data == null) return null
if (typeof data === 'string' || typeof data === 'number') return String(data)
if (typeof data === 'object') {
const v = data.id?? data.taskId?? data.taskInstanceId?? data.instanceId
?? data.taskInstanceID?? data.userTaskId?? data.user_task_id
?? data.recordId?? data.record_id?? data.taskRecordId
return v == null? null: String(v)
}
return null
}

function signIndex() {
return new Promise((resolve) => {
const signheaderVal = $.getdata(KEY_SIGNHEADER)
if (!signheaderVal) {
$.log('未获取到 Cookie，请先通过 MiTM 获取：在 APP 打开「领福利」→ 点击签到')
$.msg($.name, '', '请先配置抓包脚本，在 APP 领福利页点击签到以获取 Cookie')
resolve(null)
return
}
try {
$.headers = JSON.parse(signheaderVal)
} catch (e) {
$.log('保存的请求头损坏，请重新抓包')
resolve(null)
return
}
$.phone = $.headers.phone || $.headers.Phone || '当前账号'
postApiRetry('/index/signIndex', {}, $.headers, 'signIndex').then((data) => resolve(data))
})
}

async function doSignIn() {
const todayDate = getTodayDate()
let signRes = await postApiRetry('/index/sign', { type: 1, day: todayDate}, $.headers, 'sign')
// 签到 5000 多半是服务端一时的问题，5 秒后只重试一次；还失败就停手，别再撞
if (signRes && signRes.code === 5000) {
$.log('签到服务端 5000，5 秒后重试一次')
await $.wait(5000)
signRes = await postApiRetry('/index/sign', { type: 1, day: todayDate}, $.headers, 'sign-retry')
}
return signRes
}

async function getTaskList() {
let res = await postApiRetry('/task/taskList?version=11.0.7', {}, $.headers, 'taskList')
if (!res || res.code!== 2200 ||!Array.isArray(res.data)) {
$.log('任务列表带 version 请求异常，去掉 version 再试一次')
res = await postApiRetry('/task/taskList', {}, $.headers, 'taskList-nover')
}
return res
}

function taskStart(taskCode) {
return postApiRetry('/task/start', { taskCode}, $.headers, `start:${taskCode}`)
}

// finish 带上 taskCode：服务端报“任务类型错误”很可能就是缺这个字段
function taskFinish(taskId, taskCode) {
const body = taskCode? { id: taskId, taskCode}: { id: taskId}
return postApiRetry('/task/finish', body, $.headers, `finish:${taskId}`)
}

function taskReceive(taskId) {
return postApiRetry('/task/receive', { id: taskId}, $.headers, `receive:${taskId}`)
}

// 完成 + 领取：只在无响应时重试；5000 业务错误直接返回原因，不重试
async function finishAndReceive(taskId, taskCode, title) {
const finishRes = await taskFinish(taskId, taskCode)
if (!finishRes) return { ok: false, reason: '完成无响应'}
if (finishRes.code!== 2200) {
return { ok: false, reason: `完成失败(code=${finishRes.code} ${finishRes.message || ''})`}
}
const receiveRes = await taskReceive(taskId)
if (receiveRes && receiveRes.code === 2200) {
return { ok: true, reason: '已领取'}
}
const msg = receiveRes? `${receiveRes.code} ${receiveRes.message || ''}`: '无响应'
if (/已领|重复|already/i.test(msg)) return { ok: true, reason: '已领取'}
return { ok: false, reason: `完成成功但领取失败(${msg})`}
}

async function runSignIn() {
$.accountResult = ''
$.signSuccess = false
$.tokenInvalid = false
$.taskResults = []

const signIndexRes = await signIndex()
if (!signIndexRes) return
if (signIndexRes.code!== 2200) {
$.log(`用户 - token 失效了，请重新在 APP 领福利页点击签到以更新`)
$.tokenInvalid = true
$.accountResult = `📱 账号：${$.phone}\n❌ token 失效，请重新抓包获取\n\n`
$.msg('✈️ 同程旅行签到结果\n⚠️ Token 失效', '', $.accountResult)
return
}

const todaySign = signIndexRes.data?.todaySign
const mileage = signIndexRes.data?.mileageBalance?.mileage?? 0
$.log(`用户 - 今日${todaySign? '已': '未'}签到，当前剩余里程 ${mileage}！`)

if (todaySign) {
$.signSuccess = true
} else {
$.log(`用户 - 今日未签到，开始执行签到`)
const signRes = await doSignIn()
const signMsg = signRes? `${signRes.code} ${signRes.message || ''}`: '无响应'
if (signRes && signRes.code === 2200) {
$.log(`用户 - 签到成功！`)
$.signSuccess = true
} else if (/已签|已经签|already/i.test(signMsg)) {
$.log(`用户 - 实际已签到（${signMsg}），按成功算`)
$.signSuccess = true
} else {
$.signError = signMsg
$.log(`用户 - 签到失败！${signMsg}。服务端 5000 的话请在 App 里手动签到一次保住连续签到`)
}
}

// 任务列表：签到后重新拉一次，签到解锁的新任务也能拿到
let taskListRes = await getTaskList()
if ((!taskListRes ||!Array.isArray(taskListRes.data) || taskListRes.data.length === 0) && elapsedMs() < 60000) {
$.log('任务列表为空，3 秒后重新拉一次')
await $.wait(3000)
taskListRes = await getTaskList()
}

if (taskListRes && taskListRes.code === 2200 && Array.isArray(taskListRes.data)) {
// 状态分流：0/1 未开始，2 进行中，3 已完成待领取，4 已领完跳过；其他未知状态也尝试跑一次
const todo = taskListRes.data.filter((t) => t.state!== 4)
// 浏览时长从短到长，先把能做的做完，避免长任务占满超时
todo.sort((a, b) => (a.browserTime || 0) - (b.browserTime || 0))
$.log(`任务列表共 ${taskListRes.data.length} 个，待处理 ${todo.length} 个`)

for (const task of todo) {
if (elapsedMs() > MAX_RUNTIME_MS) {
$.log(`已用 ${Math.round(elapsedMs() / 1000)} 秒，接近超时，剩余任务跳过`)
$.taskResults.push({ title: '剩余任务', ok: false, reason: '超时跳过，请明天再跑或手动做'})
break
}
const { taskCode, title, browserTime} = task
const state = task.state
const needBrowse = browserTime || 0
const instanceIdFromList = task.id!= null? String(task.id): (task.taskId!= null? String(task.taskId): null)
// 详情日志：下次截图发我，靠这行定位是哪类任务过不了
$.log(`任务详情 title=${title} taskCode=${taskCode} state=${state} taskType=${task.taskType?? task.type?? ''} browserTime=${needBrowse} id=${instanceIdFromList}`)
$.log(`任务原始数据 ${JSON.stringify(task)}`)
const taskType = task.taskType ?? task.type
if (taskType === 13 || taskType === '13') {
  $.log(`任务 ${title} 是跳转第三方 App 的任务（type=13），脚本无法完成，跳过`)
  $.taskResults.push({ title, ok: false, reason: '需跳转第三方 App 完成，脚本跳过' })
  continue
}

// state 3：已完成，只领奖一次；报“状态不对”就是已领过或状态异常，直接跳过
if (state === 3) {
const id = instanceIdFromList
if (!id) {
$.taskResults.push({ title, ok: false, reason: '待领取但拿不到任务实例 id'})
continue
}
$.log(`任务已完成，直接领取`)
const recv = await taskReceive(id)
if (recv && recv.code === 2200) {
$.taskResults.push({ title, ok: true, reason: '已领取'})
} else {
const msg = recv? `${recv.code} ${recv.message || ''}`: '无响应'
$.taskResults.push({ title, ok: false, reason: `领取失败(${msg})，可能已领过，跳过`})
}
continue
}

// state 2：进行中，跳过 start，直接 finish
if (state === 2) {
const id = instanceIdFromList
if (!id) {
$.taskResults.push({ title, ok: false, reason: '进行中但拿不到任务实例 id'})
continue
}
$.log(`任务进行中，直接完成`)
const r = await finishAndReceive(id, taskCode, title)
$.taskResults.push({ title, ok: r.ok, reason: r.reason})
continue
}

// state 0 / 1 / 其他：先 start
$.log(`开始做任务，需要浏览 ${needBrowse} 秒`)
const startRes = await taskStart(taskCode)
if (!startRes || startRes.code!== 2200) {
const msg = startRes? `code=${startRes.code} ${startRes.message || ''}`: '无响应'
if (instanceIdFromList) {
$.log(`任务start 失败(${msg})，改用列表里的实例 id 继续`)
const r = await finishAndReceive(instanceIdFromList, taskCode, title)
$.taskResults.push({ title, ok: r.ok, reason: r.reason})
} else {
$.log(`任务开始失败(${msg})，跳过`)
$.taskResults.push({ title, ok: false, reason: `开始失败(${msg})`})
}
continue
}
let taskId = parseInstanceId(startRes.data)
if (!taskId) {
$.log(`⚠️ 任务start 成功但解析不到实例 id，原始返回：${JSON.stringify(startRes.data)}，改用列表 id 继续`)
taskId = instanceIdFromList
}
if (!taskId) {
$.taskResults.push({ title, ok: false, reason: `start 成功但拿不到实例 id，原始返回：${JSON.stringify(startRes.data)}`})
continue
}
// 0 秒任务也等 2 秒让服务端登记；浏览任务多等 3 秒防“时长不足”
const waitMs = needBrowse > 0? (needBrowse + 3) * 1000: 2000
await $.wait(waitMs)
const r = await finishAndReceive(taskId, taskCode, title)
$.log(`任务${r.ok? '完成': '未完成'}：${r.reason}`)
$.taskResults.push({ title, ok: r.ok, reason: r.reason})
}
} else {
$.log(`获取任务列表失败：${taskListRes? `code=${taskListRes.code} ${taskListRes.message || ''}`: '无响应'}`)
$.taskResults.push({ title: '任务列表', ok: false, reason: '拉取失败，请检查 Token 或稍后重试'})
}

const mileageRes = await postApiRetry('/index/signIndex', {}, $.headers, 'signIndex-final')
if (mileageRes && mileageRes.code === 2200 && mileageRes.data) {
const d = mileageRes.data
const cycleSignNum = d.cycleSighNum
const mileage2 = d.mileageBalance?.mileage?? 0
const todayMileage = d.mileageBalance?.todayMileage?? 0
$.log(`用户 - 本月签到 ${cycleSignNum} 天，今日共获取 ${todayMileage} 里程，当前剩余里程 ${mileage2}`)
const statusIcon = $.signSuccess? '✨️': '❗️'
const resultText = $.signSuccess
? `${statusIcon} 签到成功，本月签到 ${cycleSignNum} 天`
: `${statusIcon} 签到暂不可用，请前往 APP 手动签到！\n🈷️ 本月签到 ${cycleSignNum} 天`
const taskLines = ($.taskResults || []).map((t) => `${t.ok? '✅': '❌'} ${t.title}：${t.reason}`).join('\n')
const rewardKeys = ['mileage', 'rewardMileage', 'awardMileage', 'integral', 'reward', 'points', 'prizeMileage', 'giftMileage', 'award', 'bonus', 'score']
let ceiling = 0
let rewardField = ''
if (taskListRes && Array.isArray(taskListRes.data)) {
for (const t of taskListRes.data) {
const tt = t.taskType ?? t.type
if (tt === 13 || tt === '13' || t.state === 4) continue
let v = 0
let f = ''
for (const k of rewardKeys) {
const val = t[k]
if (typeof val === 'number' && val > 0) { v = val; f = k; break }
if (typeof val === 'string' && /^\d+$/.test(val)) { v = parseInt(val, 10); f = k; break }
}
if (!v) {
const nested = t.rewardInfo || t.awardInfo || t.prizeInfo
if (nested && typeof nested === 'object') {
for (const k of rewardKeys) {
const val = nested[k]
if (typeof val === 'number' && val > 0) { v = val; f = k; break }
}
}
}
if (v > 0) { ceiling += v; if (!rewardField) rewardField = f }
}
}
const ceilingLine = ceiling > 0
? `今日任务估算上限 ${ceiling} 里程（按任务列表 ${rewardField} 字段加总，已跳过第三方跳转任务）`
: '任务列表里没找到里程数字段，无法估算今日上限'
const signErrLine = (!$.signSuccess && $.signError) ? `签到失败原因：${$.signError}\n` : ''
$.accountResult = `📱 账号：${$.phone}\n${resultText}\n${signErrLine}🎁 当前里程 ${mileage2}(+${todayMileage})\n${ceilingLine}\n\n${taskLines? `任务：\n${taskLines}\n\n`: ''}`
} else {
$.accountResult = `📱 账号：${$.phone}\n`
if ($.signSuccess) $.accountResult += '✅ 签到成功（但获取里程信息失败）\n\n'
else $.accountResult += '❌ 签到失败且获取里程信息失败\n\n'
const taskLines = ($.taskResults || []).map((t) => `${t.ok? '✅': '❌'} ${t.title}：${t.reason}`).join('\n')
if (taskLines) $.accountResult += `任务：\n${taskLines}\n\n`
}

let title = '✈️ 同程旅行签到结果\n'
if ($.tokenInvalid) title += ' ⚠️ Token 失效'
$.msg(title, '', $.accountResult.trim())
}


// 入口：MiTM 时保存 Cookie，否则执行签到
const isMitmRequest =
typeof $request!== 'undefined' &&
$request &&
typeof $request.url === 'string' &&
/\/welfarecenter\/index\/signIndex/.test($request.url) &&
$request.headers

if (isMitmRequest) {
if ($request.method!== 'OPTIONS') {
const headers = $request.headers || {}
const hasToken = headers.apptoken || headers.Apptoken || headers['apptoken'] || headers.token || headers.Authorization
if (!hasToken) {
// 没抓到 apptoken 的请求头不覆盖已保存的好 Cookie，避免把有效 Cookie 洗掉
$.log('抓到的请求头里没有 apptoken，不覆盖已保存的 Cookie')
$.msg($.name, '未抓到有效请求头', '请在 APP 领福利页点一次签到再试')
} else {
$.setdata(JSON.stringify(headers), KEY_SIGNHEADER)
$.msg($.name, '获取同程旅行账户成功', '请运行签到脚本')
}
$.done()
} else {
$.log('获取同程旅行账户失败')
$.done()
}
} else {
!(async () => {
await runSignIn()
})()
.catch((e) => $.logErr(e))
.finally(() => $.done())
}


function Env(e,t){class s{constructor(e){this.env=e}send(e,t="GET"){e="string"==typeof e?{url:e}:e;let s=this.get;"POST"===t&&(s=this.post);const i=new Promise(((t,i)=>{s.call(this,e,((e,s,o)=>{e?i(e):t(s)}))}));return e.timeout?((e,t=1e3)=>Promise.race([e,new Promise(((e,s)=>{setTimeout((()=>{s(new Error("请求超时"))}),t)}))]))(i,e.timeout):i}get(e){return this.send.call(this.env,e)}post(e){return this.send.call(this.env,e,"POST")}}return new class{constructor(e,t){this.logLevels={debug:0,info:1,warn:2,error:3},this.logLevelPrefixs={debug:"[DEBUG] ",info:"[INFO] ",warn:"[WARN] ",error:"[ERROR] "},this.logLevel="info",this.name=e,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",this.startTime=(new Date).getTime(),Object.assign(this,t),this.log("",`🔔${this.name}, 开始!`)}getEnv(){return"undefined"!=typeof $environment&&$environment["surge-version"]?"Surge":"undefined"!=typeof $environment&&$environment["stash-version"]?"Stash":"undefined"!=typeof module&&module.exports?"Node.js":"undefined"!=typeof $task?"Quantumult X":"undefined"!=typeof $loon?"Loon":"undefined"!=typeof $rocket?"Shadowrocket":void 0}isNode(){return"Node.js"===this.getEnv()}isQuanX(){return"Quantumult X"===this.getEnv()}isSurge(){return"Surge"===this.getEnv()}isLoon(){return"Loon"===this.getEnv()}isShadowrocket(){return"Shadowrocket"===this.getEnv()}isStash(){return"Stash"===this.getEnv()}toObj(e,t=null){try{return JSON.parse(e)}catch{return t}}toStr(e,t=null,...s){try{return JSON.stringify(e,...s)}catch{return t}}getjson(e,t){let s=t;if(this.getdata(e))try{s=JSON.parse(this.getdata(e))}catch{}return s}setjson(e,t){try{return this.setdata(JSON.stringify(e),t)}catch{return!1}}getScript(e){return new Promise((t=>{this.get({url:e},((e,s,i)=>t(i)))}))}runScript(e,t){return new Promise((s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let o=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");o=o?1*o:20,o=t&&t.timeout?t.timeout:o;const[r,a]=i.split("@"),n={url:`http://${a}/v1/scripting/evaluate`,body:{script_text:e,mock_type:"cron",timeout:o},headers:{"X-Key":r,Accept:"*/*"},policy:"DIRECT",timeout:o};this.post(n,((e,t,i)=>s(i)))})).catch((e=>this.logErr(e)))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const e=this.path.resolve(this.dataFile),t=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(e),i=!s&&this.fs.existsSync(t);if(!s&&!i)return{};{const i=s?e:t;try{return JSON.parse(this.fs.readFileSync(i))}catch(e){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const e=this.path.resolve(this.dataFile),t=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(e),i=!s&&this.fs.existsSync(t),o=JSON.stringify(this.data);s?this.fs.writeFileSync(e,o):i?this.fs.writeFileSync(t,o):this.fs.writeFileSync(e,o)}}lodash_get(e,t,s){const i=t.replace(/\[(\d+)\]/g,".$1").split(".");let o=e;for(const e of i)if(o=Object(o)[e],void 0===o)return s;return o}lodash_set(e,t,s){return Object(e)!==e||(Array.isArray(t)||(t=t.toString().match(/[^.[\]]+/g)||[]),t.slice(0,-1).reduce(((e,s,i)=>Object(e[s])===e[s]?e[s]:e[s]=Math.abs(t[i+1])>>0==+t[i+1]?[]:{}),e)[t[t.length-1]]=s),e}getdata(e){let t=this.getval(e);if(/^@/.test(e)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(e),o=s?this.getval(s):"";if(o)try{const e=JSON.parse(o);t=e?this.lodash_get(e,i,""):t}catch(e){t=""}}return t}setdata(e,t){let s=!1;if(/^@/.test(t)){const[,i,o]=/^@(.*?)\.(.*?)$/.exec(t),r=this.getval(i),a=i?"null"===r?null:r||"{}":"{}";try{const t=JSON.parse(a);this.lodash_set(t,o,e),s=this.setval(JSON.stringify(t),i)}catch(t){const r={};this.lodash_set(r,o,e),s=this.setval(JSON.stringify(r),i)}}else s=this.setval(e,t);return s}getval(e){switch(this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":return $persistentStore.read(e);case"Quantumult X":return $prefs.valueForKey(e);case"Node.js":return this.data=this.loaddata(),this.data[e];default:return this.data&&this.data[e]||null}}setval(e,t){switch(this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":return $persistentStore.write(e,t);case"Quantumult X":return $prefs.setValueForKey(e,t);case"Node.js":return this.data=this.loaddata(),this.data[t]=e,this.writedata(),!0;default:return this.data&&this.data[t]||null}}initGotEnv(e){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,e&&(e.headers=e.headers?e.headers:{},e&&(e.headers=e.headers?e.headers:{},void 0===e.headers.cookie&&void 0===e.headers.Cookie&&void 0===e.cookieJar&&(e.cookieJar=this.ckjar)))}get(e,t=(()=>{})){switch(e.headers&&(delete e.headers["Content-Type"],delete e.headers["Content-Length"],delete e.headers["content-type"],delete e.headers["content-length"]),e.params&&(e.url+="?"+this.queryStr(e.params)),void 0===e.followRedirect||e.followRedirect||((this.isSurge()||this.isLoon())&&(e["auto-redirect"]=!1),this.isQuanX()&&(e.opts?e.opts.redirection=!1:e.opts={redirection:!1})),this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":default:this.isSurge()&&this.isNeedRewrite&&(e.headers=e.headers||{},Object.assign(e.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(e,((e,s,i)=>{!e&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),t(e,s,i)}));break;case"Quantumult X":this.isNeedRewrite&&(e.opts=e.opts||{},Object.assign(e.opts,{hints:!1})),$task.fetch(e).then((e=>{const{statusCode:s,statusCode:i,headers:o,body:r,bodyBytes:a}=e;t(null,{status:s,statusCode:i,headers:o,body:r,bodyBytes:a},r,a)}),(e=>t(e&&e.error||"UndefinedError")));break;case"Node.js":let s=require("iconv-lite");this.initGotEnv(e),this.got(e).on("redirect",((e,t)=>{try{if(e.headers["set-cookie"]){const s=e.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),t.cookieJar=this.ckjar}}catch(e){this.logErr(e)}})).then((e=>{const{statusCode:i,statusCode:o,headers:r,rawBody:a}=e,n=s.decode(a,this.encoding);t(null,{status:i,statusCode:o,headers:r,rawBody:a,body:n},n)}),(e=>{const{message:i,response:o}=e;t(i,o,o&&s.decode(o.rawBody,this.encoding))}));break}}post(e,t=(()=>{})){const s=e.method?e.method.toLocaleLowerCase():"post";switch(e.body&&e.headers&&!e.headers["Content-Type"]&&!e.headers["content-type"]&&(e.headers["content-type"]="application/x-www-form-urlencoded"),e.headers&&(delete e.headers["Content-Length"],delete e.headers["content-length"]),void 0===e.followRedirect||e.followRedirect||((this.isSurge()||this.isLoon())&&(e["auto-redirect"]=!1),this.isQuanX()&&(e.opts?e.opts.redirection=!1:e.opts={redirection:!1})),this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":default:this.isSurge()&&this.isNeedRewrite&&(e.headers=e.headers||{},Object.assign(e.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient[s](e,((e,s,i)=>{!e&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),t(e,s,i)}));break;case"Quantumult X":e.method=s,this.isNeedRewrite&&(e.opts=e.opts||{},Object.assign(e.opts,{hints:!1})),$task.fetch(e).then((e=>{const{statusCode:s,statusCode:i,headers:o,body:r,bodyBytes:a}=e;t(null,{status:s,statusCode:i,headers:o,body:r,bodyBytes:a},r,a)}),(e=>t(e&&e.error||"UndefinedError")));break;case"Node.js":let i=require("iconv-lite");this.initGotEnv(e);const{url:o,...r}=e;this.got[s](o,r).then((e=>{const{statusCode:s,statusCode:o,headers:r,rawBody:a}=e,n=i.decode(a,this.encoding);t(null,{status:s,statusCode:o,headers:r,rawBody:a,body:n},n)}),(e=>{const{message:s,response:o}=e;t(s,o,o&&i.decode(o.rawBody,this.encoding))}));break}}time(e,t=null){const s=t?new Date(t):new Date;let i={"M+":s.getMonth()+1,"d+":s.getDate(),"H+":s.getHours(),"m+":s.getMinutes(),"s+":s.getSeconds(),"q+":Math.floor((s.getMonth()+3)/3),S:s.getMilliseconds()};/(y+)/.test(e)&&(e=e.replace(RegExp.$1,(s.getFullYear()+"").substr(4-RegExp.$1.length)));for(let t in i)new RegExp("("+t+")").test(e)&&(e=e.replace(RegExp.$1,1==RegExp.$1.length?i[t]:("00"+i[t]).substr((""+i[t]).length)));return e}queryStr(e){let t="";for(const s in e){let i=e[s];null!=i&&""!==i&&("object"==typeof i&&(i=JSON.stringify(i)),t+=`${s}=${i}&`)}return t=t.substring(0,t.length-1),t}msg(t=e,s="",i="",o={}){const r=e=>{const{$open:t,$copy:s,$media:i,$mediaMime:o}=e;switch(typeof e){case void 0:return e;case"string":switch(this.getEnv()){case"Surge":case"Stash":default:return{url:e};case"Loon":case"Shadowrocket":return e;case"Quantumult X":return{"open-url":e};case"Node.js":return}case"object":switch(this.getEnv()){case"Surge":case"Stash":case"Shadowrocket":default:{const r={};let a=e.openUrl||e.url||e["open-url"]||t;a&&Object.assign(r,{action:"open-url",url:a});let n=e["update-pasteboard"]||e.updatePasteboard||s;n&&Object.assign(r,{action:"clipboard",text:n});let h=e.mediaUrl||e["media-url"]||i;if(h){let e,t;if(h.startsWith("http"));else if(h.startsWith("data:")){const[s]=h.split(";"),[,i]=h.split(",");e=i,t=s.replace("data:","")}else{e=h,t=(e=>{const t={JVBERi0:"application/pdf",R0lGODdh:"image/gif",R0lGODlh:"image/gif",iVBORw0KGgo:"image/png","/9j/":"image/jpg"};for(var s in t)if(0===e.indexOf(s))return t[s];return null})(h)}Object.assign(r,{"media-url":h,"media-base64":e,"media-base64-mime":o??t})}return Object.assign(r,{"auto-dismiss":e["auto-dismiss"],sound:e.sound}),r}case"Loon":{const s={};let o=e.openUrl||e.url||e["open-url"]||t;o&&Object.assign(s,{openUrl:o});let r=e.mediaUrl||e["media-url"]||i;return r&&Object.assign(s,{mediaUrl:r}),console.log(JSON.stringify(s)),s}case"Quantumult X":{const o={};let r=e["open-url"]||e.url||e.openUrl||t;r&&Object.assign(o,{"open-url":r});let a=e.mediaUrl||e["media-url"]||i;a&&Object.assign(o,{"media-url":a});let n=e["update-pasteboard"]||e.updatePasteboard||s;return n&&Object.assign(o,{"update-pasteboard":n}),console.log(JSON.stringify(o)),o}case"Node.js":return}default:return}};if(!this.isMute)switch(this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":default:$notification.post(t,s,i,r(o));break;case"Quantumult X":$notify(t,s,i,r(o));break;case"Node.js":break}if(!this.isMuteLog){let e=["","==============📣系统通知📣=============="];e.push(t),s&&e.push(s),i&&e.push(i),console.log(e.join("\n")),this.logs=this.logs.concat(e)}}debug(...e){this.logLevels[this.logLevel]<=this.logLevels.debug&&(e.length>0&&(this.logs=[...this.logs,...e]),console.log(`${this.logLevelPrefixs.debug}${e.map((e=>e??String(e))).join(this.logSeparator)}`))}info(...e){this.logLevels[this.logLevel]<=this.logLevels.info&&(e.length>0&&(this.logs=[...this.logs,...e]),console.log(`${this.logLevelPrefixs.info}${e.map((e=>e??String(e))).join(this.logSeparator)}`))}warn(...e){this.logLevels[this.logLevel]<=this.logLevels.warn&&(e.length>0&&(this.logs=[...this.logs,...e]),console.log(`${this.logLevelPrefixs.warn}${e.map((e=>e??String(e))).join(this.logSeparator)}`))}error(...e){this.logLevels[this.logLevel]<=this.logLevels.error&&(e.length>0&&(this.logs=[...this.logs,...e]),console.log(`${this.logLevelPrefixs.error}${e.map((e=>e??String(e))).join(this.logSeparator)}`))}log(...e){e.length>0&&(this.logs=[...this.logs,...e]),console.log(e.map((e=>e??String(e))).join(this.logSeparator))}logErr(e,t){switch(this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":case"Quantumult X":default:this.log("",`❗️${this.name}, 错误!`,t,e);break;case"Node.js":this.log("",`❗️${this.name}, 错误!`,t,void 0!==e.message?e.message:e,e.stack);break}}wait(e){return new Promise((t=>setTimeout(t,e)))}done(e={}){const t=((new Date).getTime()-this.startTime)/1e3;switch(this.log("",`🔔${this.name}, 结束! 🕛 ${t} 秒`),this.log(),this.getEnv()){case"Surge":case"Loon":case"Stash":case"Shadowrocket":case"Quantumult X":default:$done(e);break;case"Node.js":process.exit(1)}}}(e,t)}