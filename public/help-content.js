/* Product help contains only public instructions and official links. */
(() => {
  const links = {
    ark: ['方舟快速入门', 'https://docs.volcengine.com/docs/82379/1399008'],
    arkKey: ['获取方舟 API Key', 'https://ark.volcengine.com/region:cn-beijing/apiKey'],
    arkModels: ['开通模型服务', 'https://ark.volcengine.com/region:cn-beijing/openManagement'],
    speech: ['火山语音接入文档', 'https://docs.volcengine.com/docs/6561/1598757'],
    speechKey: ['语音控制台', 'https://console.volcengine.com/speech/new'],
    speakers: ['官方音色列表', 'https://www.volcengine.com/docs/6561/1257544'],
    codex: ['Codex 安装与登录', 'https://developers.openai.com/codex/cli/'],
    openai: ['OpenAI API 文档', 'https://platform.openai.com/docs/overview'],
    openaiKey: ['OpenAI API Keys', 'https://platform.openai.com/api-keys'],
    anthropic: ['Claude API 文档', 'https://docs.anthropic.com/en/api/getting-started'],
    anthropicKey: ['Claude Console', 'https://console.anthropic.com/'],
    fish: ['Fish Audio 官方文档', 'https://docs.fish.audio/'],
    fishConsole: ['Fish Audio 控制台', 'https://fish.audio/'],
    ollama: ['Ollama 兼容接口', 'https://docs.ollama.com/api/openai-compatibility'],
    qqMusicApi: ['QQMusicApi 项目与部署', 'https://gitee.com/gnnu/QQMusicApi'],
    qqCookie: ['QQMusicApi Cookie 说明', 'https://gitee.com/gnnu/QQMusicApi#cookie']
  };
  const help = (title, text, example = '', docs = []) => ({ title, text, example, docs });
  const ai = {
    ark: {
      provider: help('火山方舟 · 助理的大脑', '用于理解你的聊天、选歌和生成解说。先在方舟开通模型，再填同一账号的 API Key。', '', [links.ark]),
      base: help('方舟 API 地址', '通常保留默认值即可。填写 API 根地址，不追加 /responses，也不要粘贴控制台网页地址。', 'https://ark.cn-beijing.volces.com/api/v3', [links.ark]),
      model: help('模型 ID', '从方舟已开通模型的调用示例中复制完整模型 ID，或填该账号可调用的 ep- 开头接入点 ID。需要支持 Responses API 和 JSON 输出；示例名称不保证你的账号已开通。', '完整模型 ID 或 ep-…', [links.arkModels, links.ark]),
      key: help('方舟大模型 API Key', '在方舟「API Key 管理」中创建并复制 Key，只粘贴 Key 本身。保存后留空表示保留已有 Key；清除请用旁边的垃圾桶。语音 Key 请填写到右侧语音服务。', '', [links.arkKey])
    },
    'codex-cli': {
      provider: help('使用 ChatGPT 登录态', '先在运行 Forever 的电脑安装 Codex CLI，再点「登录 Codex」完成登录。Windows 桌面版需要能在同一 Windows 用户环境找到 Codex。', 'npm install -g @openai/codex', [links.codex]),
      base: help('由 Codex 管理连接', '此模式无需填写 API 地址，连接由本机 Codex CLI 管理。', '', [links.codex]),
      model: help('Codex 模型可留空', '留空沿用本机 Codex 的默认模型。只有明确知道账号可用模型时，才填写 Codex 支持的模型名称。', '留空即可', [links.codex]),
      key: help('此模式无需填写 Key', '使用「登录 Codex」连接 ChatGPT 账号，点击「重新检测」查看安装及登录状态。', '', [links.codex])
    },
    openai: {
      provider: help('OpenAI · 助理的大脑', '使用 OpenAI API 理解对话和推荐歌曲。需要具备 API 调用权限和额度的账号。', '', [links.openai]),
      base: help('OpenAI API 地址', '保留官方默认地址。此选项使用 Responses API，地址末尾无需追加 /responses。', 'https://api.openai.com/v1', [links.openai]),
      model: help('OpenAI 模型 ID', '从官方模型列表或账号调用示例复制支持 Responses API 和结构化输出的模型 ID。', 'gpt-4.1-mini（需账号可用）', [links.openai]),
      key: help('OpenAI API Key', '在 OpenAI API 平台创建 Key，粘贴 Key 本身。ChatGPT 订阅登录与 API Key 是两种接入方式；保存后留空保留已有 Key。', '', [links.openaiKey])
    },
    anthropic: {
      provider: help('Claude · 助理的大脑', '使用 Anthropic Claude API。需要在 Claude Console 获取 API Key。', '', [links.anthropic]),
      base: help('Claude API 地址', '通常保留默认值，不追加 /messages。', 'https://api.anthropic.com/v1', [links.anthropic]),
      model: help('Claude 模型 ID', '从 Claude Console 或官方文档复制当前账号支持的完整模型 ID，保留日期或版本后缀。', '', [links.anthropic]),
      key: help('Claude API Key', '在 Claude Console 创建 API Key。只粘贴 Key 本身，保存后留空保留已有值。', '', [links.anthropicKey])
    },
    'openai-compatible': {
      provider: help('兼容服务 / 本地模型', '连接提供 OpenAI Chat Completions 接口的服务，例如本机 Ollama。模型需要能按要求返回 JSON。', '', [links.ollama]),
      base: help('兼容服务根地址', '按服务商文档填写 API 根地址，不追加 /chat/completions。localhost 指运行 Forever 的这台电脑。', 'http://localhost:11434/v1', [links.ollama]),
      model: help('兼容服务的模型名称', '填写服务商提供的模型 ID；本地 Ollama 填已下载模型的完整名称，需与本机列表一致。', '以服务商或本机模型列表为准', [links.ollama]),
      key: help('按服务商要求填写', '本地免鉴权服务可留空；远程服务填该服务商的 Key。已有 Key 留空会保留，改用免鉴权服务前可主动清除。', '', [links.ollama])
    }
  };
  const voice = {
    volcengine: {
      provider: help('火山语音 · 助理的声音', '将助理回复读出来。先开通语音合成并获取语音控制台 API Key，保存后去「声音」页选择音色。', '', [links.speechKey, links.speech]),
      endpoint: help('语音合成接口地址', '通常保持默认的 HTTP 单向流式地址。这里填写完整接口路径，和左侧模型 API 根地址的规则不同。', 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', [links.speech]),
      id: help('火山语音此处可留空', '这个字段供 Fish Audio 使用。火山的音色请在「声音」页选择；复刻音色填入那一页的「自定义 Speaker ID」。', '留空', [links.speakers]),
      key: help('语音专用 API Key', '在火山语音新版控制台的 API Key 管理中获取，需具备所选语音资源权限。填写 API Key 本身，无需填写 App ID、Secret Key 或 Bearer 前缀。', '', [links.speechKey, links.speech])
    },
    'fish-audio': {
      provider: help('Fish Audio · 助理的声音', '使用 Fish Audio 生成语音。在该平台获取 API Key，并按需选择一个可用音色。', '', [links.fish]),
      endpoint: help('Fish Audio 接口地址', '通常保留默认的完整 TTS 接口地址。', 'https://api.fish.audio/v1/tts', [links.fish]),
      id: help('Voice / Reference ID', '在 Fish Audio 的音色或模型页面复制 reference_id。填写 ID 而不是音色名称或网页链接；留空时使用服务默认音色。', '', [links.fishConsole, links.fish]),
      key: help('Fish Audio API Key', '在 Fish Audio 平台创建 API Key，复制后粘贴到这里。保存后留空会保留原 Key。', '', [links.fishConsole, links.fish])
    },
    'browser-speech': {
      provider: help('使用系统语音', '无需云端语音 Key。由系统或浏览器提供可用声音，不同设备的音色和可用性可能不同。', '不需要填写下方三项'),
      endpoint: help('系统语音无需接口地址', '此选项下无需填写。切换到云端语音服务时再配置。'),
      id: help('系统语音无需 Reference ID', '此选项下无需填写，音色由系统或浏览器提供。'),
      key: help('系统语音无需 API Key', '此选项下无需填写，之前保存的其他语音服务 Key 会独立保留。')
    }
  };
  const fields = {
    'assistant-name': help('给 DJ 起个名字', '填写你喜欢的助理名称，最多 32 个字符。保存后同步到电台头像、对话署名和页面标题。', 'Forever / 小夜 / 你的私人 DJ'),
    'avatar-file': help('上传助理头像', '选择 JPEG、PNG 或 WebP 图片，最大 3MB。预览满意后点击本页「保存并同步」。恢复默认也需要保存。'),
    'genre-tags': help('告诉我你的音乐品味', '用逗号或换行分隔喜欢的风格，最多保留 16 个标签。标签会提供给助理作为长期推荐参考。', '爵士, 民谣, 氛围电子'),
    'taste-markdown': help('用日常语言写下偏好', '填写喜欢的歌手、常见收听场景、希望避开的风格。可写普通文字，也支持 Markdown；最多 8000 字。保存后会作为助理对话的上下文。', '工作时少人声；深夜喜欢温柔的爵士；不喜欢突然很响的开头。'),
    'directive-enabled': help('临时改变接下来的节目', '开启并填写指令后保存，在指定时间内优先按这条指令推荐，暂时覆盖通用熟悉歌曲比例。关闭并保存恢复通用推荐。'),
    'directive-instruction': help('这段时间想听什么', '写清主题和场景；开启上方开关后填写并保存。最多 500 字。', '接下来两小时只听雨声、溪流和森林白噪音'),
    'directive-duration': help('指令持续多久', '单位为分钟，允许 15～1440。时间从保存时起计算，到期后恢复通用推荐。', '120 = 两小时'),
    'familiar-rate': help('熟悉歌曲与新歌的比例', '0% 更偏向新歌，100% 更偏向听过的歌。按每组约 6 首换算，实际结果受可播放歌曲数量影响；临时指令生效时以指令优先。', '17% ≈ 1 首熟悉歌曲 + 5 首新歌'),
    'response-mode-direct': help('直接播放', '保留原有 AI DJ 风格：助理回答后直接更新播放器，适合希望少一步操作的场景。'),
    'response-mode-playlist': help('歌单卡片', '推荐成功后在对话中展示临时歌单，可播放全部或从某一首开始。歌单只保留在当前对话，不创建云端歌单。'),
    'response-mode-interactive': help('互动选择', '当请求范围较宽时，助理先给出 2～4 个可点击方向；意图明确时仍会直接推荐。点击后只发送一次完整约束。'),
    'ai-provider': () => (ai[document.getElementById('ai-provider').value] || ai.ark).provider,
    'ai-base-url': () => (ai[document.getElementById('ai-provider').value] || ai.ark).base,
    'ai-model': () => (ai[document.getElementById('ai-provider').value] || ai.ark).model,
    'ai-api-key': () => (ai[document.getElementById('ai-provider').value] || ai.ark).key,
    'voice-provider': () => (voice[document.getElementById('voice-provider').value] || voice.volcengine).provider,
    'voice-endpoint': () => (voice[document.getElementById('voice-provider').value] || voice.volcengine).endpoint,
    'voice-service-id': () => (voice[document.getElementById('voice-provider').value] || voice.volcengine).id,
    'voice-api-key': () => (voice[document.getElementById('voice-provider').value] || voice.volcengine).key,
    'music-source': help('选择歌曲从哪里获取', '自动选择会先尝试网易云，无法播放时再尝试 QQ 音乐。也可以锁定单一音源，便于排查账号或版权问题。'),
    'music-quality': help('选择网易云账号可用的音质', '首次建议选「极高」。无损等高级音质取决于网易云账号权限和歌曲版权，必要时会自动降低音质。点击「扫码登录」，用网易云音乐 App 扫码完成登录。'),
    'qq-music-base-url': help('连接你自己的 QQMusicApi', '先按项目说明独立运行 QQMusicApi，再填写它的 HTTP 根地址，不追加 /search 或 /song/url。桌面应用连接本机服务时通常使用 127.0.0.1。', 'http://127.0.0.1:3300', [links.qqMusicApi]),
    'qq-music-quality': help('选择 QQ 音乐音质', '会从所选音质开始尝试，账号或版权不支持时自动降级。FLAC 和 320K 通常更依赖有效 Cookie。', '首次建议 320K', [links.qqMusicApi]),
    'qq-music-cookie': help('QQ 音乐登录凭证', '桌面应用优先点击「扫码登录」，在隔离的 QQ 音乐官方窗口完成登录；网页端可手动填写当前 QQ 音乐网页会话的 Cookie。凭证只保存在本机 SQLite，不要分享给他人。留空会保留已有值。', '', [links.qqCookie, links.qqMusicApi]),
    'speaker-select': help('直接选择官方音色', '火山语音从下拉列表选一个音色即可，无需手动找 ID。自定义 Speaker ID 非空时会优先使用自定义音色。', '', [links.speakers]),
    'speaker-custom': help('可选：填写自定义音色 ID', '使用默认音色时留空。使用声音复刻时，在火山语音控制台完成音色创建后复制 speaker_id，并选择对应的声音复刻资源。', '填控制台返回的 speaker_id，不填音色名字', [links.speechKey, links.speakers]),
    'voice-model': help('自然表现或更快响应', '火山语音设置。「表现力增强」用于更丰富的语气；「标准低延迟」侧重响应速度。选好后用下方试听比较。', '', [links.speech]),
    'resource-id': help('和音色匹配的资源', '官方 2.0 音色选「语音合成 2.0」（seed-tts-2.0）；2.0 复刻音色选「声音复刻 2.0」（seed-icl-2.0）。账号需要开通对应资源。', '', [links.speech]),
    emotion: help('为火山音色指定情绪', '首次保留「自动判断」。也可选愉快、低落等情绪，实际表现取决于所选音色和合成模型的支持。'),
    'emotion-scale': help('情绪要明显到什么程度', '1 最轻，5 最强，默认 3。与支持情绪控制的火山音色一起使用；建议先试听再保存。'),
    'speech-rate': help('调整说话速度', '火山语音的相对语速。0 为基准，负数更慢，正数更快；范围 -50～100。', '-8：比默认稍慢'),
    'loudness-rate': help('调整合成语音响度', '火山语音相对响度，0 为基准，范围 -50～100。这是生成语音的响度；电台上的 VOL 控制实际播放音量。', '0：先保持默认'),
    'voice-style': help('像导演一样描述语气', '用自然语言描述火山语音的说话方式，最多 300 字。此处描述声音风格，想长期改变选歌偏好请到「记忆」。', '自然、松弛地说话，语速稍慢，句间保留呼吸感。'),
    'preview-text': help('听听设置后的效果', '输入一小段想让助理朗读的话，最多 500 字。先在「服务」页保存 Key，再点「生成试听」。试听会使用本页当前音色参数；满意后保存声音设置。', '晚上好，让我们一起听首歌。'),
    'style-classic': help('经典电台', '时间、歌词/评论舞台与播放条布局。选中后点击「保存并同步」，电台页面实时切换。'),
    'style-album': help('唱片沉浸', '以专辑封面和唱片队列为中心，点击两侧唱片选曲。保存后生效，保留当前音乐进度。'),
    'style-glass': help('玻璃桌面', '宽屏下左侧时钟与唱片，右侧队列与助理；窄屏自动上下排列。保存后生效，音乐继续播放。')
  };
  window.SwaggerHelpContent = { fields };
})();
