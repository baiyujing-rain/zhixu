# ChatGPT 授权设计

个人本地应用通过官方 public client / loopback OAuth 接入。无 client secret，无账号密码收集，无私有 API 或 Codex 凭据读取。前端只收到本地短期启动 ticket、账号显示信息和状态；后端的 redirect 才把授权请求送到 OpenAI。

流程：启动 transaction → browser cookie + state + nonce + PKCE → OpenAI 官方登录 → issued client ID + code → 后端交换 tokens → JWKS 校验 ID token → 校验 granted scope → 加密持久化 → 获取账号模型目录 → Responses SSE → completed 后保存讲解。

任何失败不替换原账号；有效的新注册 issued client ID 在换码失败后仍可重试，不重复创建 dynamic registration。允许用户选择已有账号或添加注册；同邮箱注册仍以 client ID + 已验证 subject 分开。Windows 使用 DPAPI 加密，其他系统原子写入 0600 文件；host ID 与注册重启后复用。

授权状态不是套餐资格保证。缺少 direct scope、403/429、未完成 SSE、网络断开均明确报错。没有自动切换 API 模式的分支。退出先尝试 discovery 提供的 revoke endpoint，再清除本机 tokens；未确认远程撤销时提示用户到 ChatGPT 设置手动断开。

回调和本地启动 ticket 的 query string 在响应前从 ASGI scope 中清除，避免 Uvicorn access log 记录授权代码。凭据不返回状态 API，不存浏览器 storage；浏览器只保存非敏感的首次欢迎说明标记。

当前仅单进程、本机使用。state 在内存中，后端在授权期间重启会取消未完成登录；已完成授权保存到本机。自动续期有进程内互斥，多 worker / 多实例需要额外跨进程锁。

官方来源见 README。真实登录需要用户亲自在浏览器中同意，开发测试使用独立数据库、临时凭据和模拟 OpenAI 服务；不声称模拟通过就是用户账号已获授权。
