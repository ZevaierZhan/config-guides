# 配置引导协议 1.0：JS 0.3.2 支持的子集

包版本 0.3.2 与描述文件 protocolVersion 1.0 是不同的版本维度。
`defineGuide` 是严格校验器，但不是通用 JSON Schema 引擎。

## 描述结构

`plugin`：id / title。
`form.schema`：object，properties 为非空单层字段，additionalProperties 必须 false。
字段支持 string / number / integer / boolean，title / description / default / enum /
minLength / maxLength / minimum / maximum。整数必须在 JS 安全范围内。
未知关键字（包括 pattern、format、$ref）直接拒绝，不会自动访问外部 schema。

`form.ui`：字段需要恰好一个控件。普通字段是 kind:field + path + widget；
secret 是 kind:secret + key。仅支持 text、textarea、url、email、number、checkbox、select。
`kind:variant` 使用一个必填 enum 字段作为 discriminator；cases 必须完整覆盖 enum，每个分支声明自己的 controls 和动态 required。`inactive` 固定为 `delete`：非活动普通字段不接受提交，非活动 secret 在候选配置和保存结果中删除。第一版不支持嵌套 variant。
URL 校验为 HTTP(S)，邮箱为基础格式检查，不做可投递验证。文本长度以 Unicode code point 计数。
布尔 false 和数值 0 是合法值，不按“空”处理。
普通字段的 `secret:` 前缀保留给字段错误标识，不允许作为字段名。

`form.secrets`：label、required、description。不能有 default，已有值不回填前端。
`targets`：仅一个 file/json/update-owned/user-only 目标。声明秘密时
必须 `allowPlaintextSecrets:true`。描述 JSON 没有任意命令、连接验证、加密或钥匙串语义；连接验证只能由可信宿主通过 JS `verify` Adapter 提供。
`bindings`：每个字段有且仅有一个映射，目标之间不能相等或存在父子关系。
`submit`：label + apply.kind:write-targets。
`requires`：可声明 file.json、ui.secret、ui.variant、ui.sanitized-html；其他能力直接拒绝。

field、secret 和 variant 控件可提供 `help:{format:"html",content:"..."}`。内容在服务端清洗，仅保留 p/br/strong/em/code/pre/ul/ol/li/a/span；只保留安全链接属性和绝对 HTTP(S) URL，链接统一在新窗口打开。script、事件属性、表单、图片、iframe、SVG、样式及其他标签或属性均被删除。

JSON Pointer 使用 ~0/~1 转义。只支持对象键，不支持数组下标。
拒绝空键及 __proto__ / constructor / prototype 等保留键，防止对象原型污染。
数据、文件和请求上限 2 MiB；JSON 嵌套上限 64。

## 路径

`userHome`：Node os.homedir()；
`userConfigDir`：Windows APPDATA，macOS ~/Library/Application Support，
Linux XDG_CONFIG_HOME（必须绝对路径）或 ~/.config。
`pluginDir`：启动上下文；specFile 场景默认描述文件目录。
`workspaceDir`：调用者必须显式提供 context.workspaceDir；不自动猜测 cwd。
传对象形式 spec 时，没有默认 pluginDir。

relative 必须用 `/`，不允许绝对路径、..、空段、反斜线、盘符、ADS、
Windows 设备保留名或尾随点/空格。基准目录的系统别名可以解析；
基准目录以下的可识别 symlink/junction、硬链接配置会被拒绝。
这不是对所有 Windows reparse point 类型的完整安全沙箱。

## 读取、默认值和提交

先读取已有文件，已有字段覆盖默认值。只把声明的普通字段和 secretStates 返回网页。
保存时重新读取文件，只替换绑定负责的字段，其他字段保留其数据值。
注释、缩进、键顺序不作无损保证。JSON 中的未知整数超出安全范围时拒绝处理，避免静默取整。
用户提交的是当前活动分支的完整普通表单；未提交的**可选普通字段会删除对应受管字段**。
未知字段错误，不会写进文件。

秘密：

```json
{ "secretUpdates": { "token": { "operation": "keep" } } }
```

replace 需要文本 value；keep/delete 禁止 value。缺少 secretUpdates 视为全部保留。
required secret 需要最终存在非空值；不修改已有值不能误当成删除。

## 文件提交

检查路径 → 创建父目录 → 协作锁 → 重读配置并比对版本 → 映射字段 →
创建同目录空临时文件 → 私有权限 → 写内容/fsync → 再次检查路径和版本 → rename。
没有 unlink 已有文件后再重命名的非原子降级方案。

重复点击和同会话修改请求串行执行。不同会话的快照陈旧会报告 CONFIG_CONFLICT。
与不遵守锁协议的外部程序之间不存在强事务。崩溃时可能留下空临时文件或锁，见 SECURITY.md。

## SDK 生命周期

runGuide 不调用 process.exit、不改变 cwd、不安装全局信号处理；宿主通过 AbortSignal 管理取消。
createGuide 创建一个独立服务，会话结束后 done 才完成，资源被关闭。
close 幂等；若调用时保存已经提交，以保存结果为准，不会声称取消撤销了保存。
即便用户恰好断开网页，已经成功的保存也会结束服务。

状态：completed + saved；或者 cancelled + unchanged（reason 区分取消/超时/中断）。
未提供 `verify` 时读取和保存不会连接外部服务；提供时，测试按钮验证候选配置但不保存，保存请求会重新验证并仅在成功后写入。

## 主要错误码

INVALID_SPEC、INVALID_OPTIONS、INVALID_REQUEST、INVALID_CONFIG、VALIDATION_FAILED、
INVALID_PATH、UNSAFE_PATH、CONFIG_CONFLICT、CONFIG_LOCKED、PATH_CONFLICT、
PERMISSION_FAILED、TOO_LARGE、IO_ERROR、ABORTED。

JSON 错误不回显原始请求内容。API 不返回具体秘密，不提供任意执行命令或任意写路径接口。
