# 安装到 DeepSeek Harness（DSH）——让技能真正被加载

> **重点：DSH 的技能发现只有一层深度。** 直接把 `ai-eng-system/engineering/xxx/SKILL.md` 当技能是**发现不到**的。
> 本文说明为什么，以及怎么装。

---

## 一、DSH 的技能发现规则（必须知道，否则装了没用）

DSH 的技能文件系统提供方按固定规则扫描根目录：

| 规则 | 内容 |
|---|---|
| **发现深度** | **只有一层**。只认 `<root>/<name>/SKILL.md` 和 `<root>/<name>.md` |
| **不支持** | 嵌套的 `**/SKILL.md`（如 `<root>/engineering/tdd/SKILL.md` **不会**被发现） |
| **技能名** | 必须是 **kebab-case**（小写+连字符） |
| **必填 frontmatter** | `name`、`description` |
| **其余 frontmatter** | `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`（详见下面三条实测说明） |
| **调用策略** | `disable-model-invocation: true` → 模型够不到；`user-invocable: false` → 人敲不到 |
| **默认** | 两个字段都省略时 = **两边都可调用**；**驼峰拼写会导致整个技能被丢弃** |

### ⚠️ 三条实测更正（读了 DSH 源码 + 实跑验证，别再照抄旧说法）

**① `whenToUse` 对模型完全不可见 —— 写了等于没写。**

DSH 源码明文（`dsh-tool-skill/README.md:164`）：

> *The catalog omits `whenToUse`, source, and provider metadata — routing is based only on name and a capped description; `whenToUse` remains provider metadata and is **not rendered by the loaded wrapper either**.*

**所以自动触发只能靠 `description`。** 触发关键词（"怎么定价""没人用怎么办"这类）**必须写进 description**。
`whenToUse` 只对人和 GUI 有意义。**本目录已把自研技能的 `whenToUse` 全部撤销**，触发词并入 description。

**② 调用字段只有两个方向有效，且 `user-invocable: true` 是空操作。**

```js
// dsh-skill-filesystem/lib/index.js:847-850
modelInvocable: disableModelInvocation !== true,   // 默认 true
userInvocable:  userInvocable !== false            // 默认 true
```

| 你想表达的 | 唯一有效写法 |
|---|---|
| **只有人能敲** | `disable-model-invocation: true` |
| 模型够不到、人也不能敲 | `user-invocable: false` |
| 两边都行（默认） | **什么都不写**（写 `user-invocable: true` 是空操作） |

**③ 布尔字段的合法值比你以为的宽**（复刻自 `dsh-skill-filesystem/lib/index.js:855-870`）：

```
接受：true / false（布尔）· 1 / 0（数字）· "1" / "0" · "true"/"false"/"yes"/"no"/"on"/"off"（大小写不敏感）
抛错 → 整个技能被丢弃：其它任何值（如 "maybe"、"2"、空串）
```

> **两种"静默消失"要分清**：**调用字段值非法** → 整个技能被丢弃；
> **驼峰拼写**（`disableModelInvocation`）→ 抛错 → **同样整个技能被丢弃**。
> 所以必须跑体检器（第九节）。

### 关于 description 长度（硬约束）

`description` 在技能目录里**上限 500 字符**（`dsh-tool-skill/lib/index.js:18`），超出会**静默截断**。
**触发词要写在前面**——截断从尾部砍。

> 实测：`code-review` 原本 **592 字符（已被静默截断）**，现已压到 301；
> 自研 10 个全在 226–403 之间，安全。

### 技能根目录（按优先级 rank 排序）

| Rank | 来源 | 路径 | 作用范围 |
|---|---|---|---|
| 100 | project-dsh | `<项目根>/.dsh/skills` | 只对该项目 |
| 200 | project-agents | `<项目根>/.agents/skills` | 只对该项目 |
| 300 | custom | 配置里的 `customSkillDirs` | 自定义 |
| 400 | user-dsh | `%USERPROFILE%\.dsh\skills` | **所有项目**（你现在的技能装在这里） |
| 500 | user-agents | `%USERPROFILE%\.agents\skills` | 所有项目 |

> **项目根** = 最近的含 `.git` 的祖先目录；没有则用当前工作目录。

---

## 二、为什么 `ai-eng-system` 目前不能用

```
<库根>\
├── engineering\
│   └── tdd\
│       └── SKILL.md        ← 从 <库根> 出发是【两层】，发现不到
└── productivity\
```

**两个问题**：
1. **层级太深**：即使把 `ai-eng-system` 加进技能根，`engineering/tdd/SKILL.md` 也是两层，扫不到。
2. **这个目录本身不是技能根**：它是**参考库**（技能按 `<桶>/<name>/SKILL.md` 组织，供人阅读与作为安装源）。
   注意：**桶目录（`engineering`、`productivity`）才是可用的技能根**——把它们传进去能扫到技能，传库根则得到 0 个。
   **本仓库已在第二节给出解决方案：用 `install-skills.ps1` 打平安装。**

而且：**部分技能的 `SKILL.md` 没有写调用策略字段**，在 DSH 里**省略即"两边都可调用"**。
这会让"本该只有人能敲的路由器"也被模型自动触发。
→ 所以安装时按需**补上 `disable-model-invocation: true`**。

---

## 三、两条使用路径（可以并用）

### 路径 A：当"参考库"用（零改动，推荐先这样）

不做任何安装。**在派活的 prompt 里显式写 SKILL.md 的绝对路径**，让 agent 自己去读：

```
【技能】读 <库根>\engineering\tdd\SKILL.md，严格按它执行。
```

**优点**：零改动、随时改、中文正文完整。
**这正是 `multi-agent-squad` 推荐的方式**——跨 agent 时显式点名路径，比指望自动触发可靠得多。

### 路径 B：装成"可直接调用的技能"（能被自动触发 / 能敲）

把技能**打平**（flatten）到技能根下：

```
%USERPROFILE%\.dsh\skills\
├── tdd\
│   └── SKILL.md            ← 一层，可被发现
├── code-review\
│   └── SKILL.md
├── multi-agent-squad\
│   └── SKILL.md
└── ...
```

**做法**：复制 `SKILL.md` 到 `<技能根>/<name>/SKILL.md`，并在 frontmatter 里**补上调用策略**：

| 期望行为 | 要写的字段 |
|---|---|
| user-invoked（只有人能敲） | `user-invocable: true` + `disable-model-invocation: true` |
| model-invoked（可自动触发） | `user-invocable: true` + `disable-model-invocation: false`（或省略） |

> **别把 `engineering/`、`productivity/` 这些目录名当技能名**——DSH 只认一层，目录结构带不进去。

---

## 四、本次新增技能的位置与调用策略

新增的 **10** 个技能写在 `engineering/` 下（保持本参考库的组织方式），**同时**为了能在 DSH 里直接调用，已打平安装到 `%USERPROFILE%\.dsh\skills\`。

| 技能 | 调用策略 | 为什么 |
|---|---|---|
| `multi-agent-squad` | 模型可调用 | **已按用户决定放开**：让 agent 自己就能加载这套编排纪律（GUI 里照样能敲） |
| `commercial-squad` | 模型可调用 | **已按用户决定放开**：agent 遇到商业落地场景可自行加载 |
| `product-validation` | 模型可调用 | 被 `commercial-squad` 派给 Validator，也可能是模型自己够到 |
| `pricing-and-monetization` | 模型可调用 | 同上 |
| `tech-selection` | 模型可调用 | 选型时随时可能够到 |
| `fullstack-delivery` | 模型可调用 | 施工时的纪律 |
| `production-readiness` | 模型可调用 | 上线前必然够到 |
| `payment-and-billing` | 模型可调用 | 接支付时够到 |
| `growth-and-analytics` | 模型可调用 | 看数据时够到 |
| `launch-and-ops` | 模型可调用 | 部署运维时够到 |

> **本目录新增的 10 个技能全部是"模型可调用"**：frontmatter 里**不写** `disable-model-invocation`
> → **agent 能自动够到，你也能在 GUI 里敲**。
>
> **更正（曾经的错误说法）**：本文档旧版写"10 个技能全部保留 `user-invocable: true`"——**这是错的**。
> 实测只有 2 个（`multi-agent-squad`、`commercial-squad`）写该字段，其余 8 个没写。
> 而且**写不写都一样**：`user-invocable: true` 是空操作（默认即 true，见第一节更正②）。
> 行为的真正决定因素是"有没有写 `disable-model-invocation: true`"——10 个都没写，所以全部模型可调用。
>
> **权衡（诚实说明）**：更保守的做法是"路由器只由人敲"，可避免模型乱加载编排技能、乱吃掉上下文。
> 本次按用户决定放开了这一条，换来"agent 能自主组队"。
> **代价**：模型可能在不需要多 agent 时也加载编排技能。
> 若日后觉得吵，给 `multi-agent-squad` / `commercial-squad` 加 `disable-model-invocation: true` 即可（改完**开新会话**生效）。

> **注意：技能之间不能互相调用**（本体系铁规）。
> 所以 `commercial-squad` **不调用** `ask-matt`——它在正文里说明分工，让**模型或人**去用 `ask-matt`。

---

## 五、安装步骤（照做即可）

```
1. 确认技能根存在
   %USERPROFILE%\.dsh\skills\

2. 对每个要安装的技能，建目录并放 SKILL.md
   <技能根>\<name>\SKILL.md

3. 打开 frontmatter，补齐调用策略
   - 本次新增的 10 个技能全部是"模型可调用"（两边都能用）：
       user-invocable: true
       （不写 disable-model-invocation）
   - 只有在你**明确想让某个技能"仅人能敲"**时才加：
       disable-model-invocation: true

4. **验证必须在新会话里做**（关键，见第七节）
   - 当前会话的目录可能在安装过程中只刷新了一部分
   - 新会话里看技能目录是否出现这些技能名
   - 名字必须是 kebab-case
   - frontmatter 里不能有驼峰拼写或非布尔的调用字段（会让整个技能被静默丢弃）

5. 更新技能后无需特殊操作：DSH 会监视技能根，
   frontmatter 变化会使目录失效并重新发现（正文改动在下次调用时重新读取）
```

**排错**：

| 症状 | 原因 |
|---|---|
| 技能不出现 | ① 层级超过一层（必须是 `<root>/<name>/SKILL.md`）② `name` 不是 kebab-case ③ 调用字段拼成驼峰或值不是布尔 → **整个技能被丢弃** |
| **新装的技能当前会话够不到，但文件明明在** | **目录刷新是异步的**；本次实测只有部分技能被纳入。**开新会话即可** |
| 技能出现但模型不自动触发 | `disable-model-invocation: true`（"仅用户调用"的正常行为） |
| 敲 `/xxx` 没反应 | `user-invocable: false` |
| 改了正文但行为没变 | 正文是**下次调用时**重新读的；确认你改的是**被加载的那个文件**（不是参考库里的副本） |

---

## 六、维护纪律：参考库是源，技能根是安装产物

**一份内容两个位置会漂移。** 建议固定一个方向：

```
<库根>\engineering\<skill>\SKILL.md    ← 【源】编辑这里
                ↓ 复制（打平）
%USERPROFILE%\.dsh\skills\<skill>\SKILL.md                        ← 【安装产物】DSH 读这里
```

**规则**：
- **只改源**，然后同步过去。
- 别在安装产物上直接改（下次同步会被覆盖，且你会忘了改过）。
- 如果你更常改安装产物，那就在源上改完后**反向同步**——但**只选一个方向**。

**同步命令**（PowerShell，改完源后跑）：

```powershell
$src = "<库根>\engineering"
$dst = "%USERPROFILE%\.dsh\skills"
foreach ($s in @("multi-agent-squad","commercial-squad","product-validation",
                 "pricing-and-monetization","tech-selection","fullstack-delivery",
                 "production-readiness","payment-and-billing",
                 "growth-and-analytics","launch-and-ops")) {
    New-Item -ItemType Directory -Force -Path "$dst\$s" | Out-Null
    Copy-Item "$src\$s\SKILL.md" "$dst\$s\SKILL.md" -Force
}
Write-Output "已同步 10 个技能"
```

---

## 七、验证安装是否真的生效

> ⚠️ **本次实测发现（重要，别误判成安装失败）**
>
> 安装 10 个技能后，**技能目录只纳入了其中 1 个**（`fullstack-delivery`），
> 其余 9 个**文件完全正确、磁盘上都在，但 `skill()` 报 unknown**。
>
> **已排除的原因**：
> - **不是数量上限**（查过 `dsh-tool-skill` 源码：目录**没有条数上限**，只有单个 description 长度上限，默认 500 字符；构建只按 `isModelInvocable` 过滤，不截断条数）
> - **不是刷新时机**（完整重启 DSH 后仍然只有 1 个）
> - **不是文件监视器故障**（实测 Chokidar 挂载技能根只要 12ms，全部配置均成功）
>
> **真正原因：frontmatter 的 YAML 解析失败**——`fullstack-delivery` **恰好是唯一能解析成功的那个**。
> 详见下面**第八节**（这是"技能装了却用不了"的头号原因，必读）。

在新会话里做这三步：

1. **看技能目录**：10 个新技能（`multi-agent-squad`、`commercial-squad`、`production-readiness` 等）
   应出现在技能列表里，并且**可以被模型自动够到**（因为已设为模型可调用）。
2. **读一次正文**：加载 `multi-agent-squad`，确认读到的是**最新版本**（不是参考库里的旧副本）。
3. **跑体检器**（见第八节）——这是**唯一能提前发现"静默丢弃"的手段**。

> 这一步符合工作区铁律"**验证纪律：关键操作必须确认生效**"——装完不验证等于没装。

---

## 八、⚠️ 最大的坑：frontmatter 的 YAML 会被静默解析失败（**必读**）

**这是本次排查耗时最久的问题，也是"技能装了却用不了"的头号原因。**

### 现象

> 技能文件在磁盘上完好，`name` 也正确，**但技能目录里就是没有它**，`skill('它')` 报 unknown。
> **没有任何报错**——DSH 对格式错误的条目**只记警告然后跳过**，模型目录甚至拿不到诊断。

### 根因（已用 DSH 自己的 yaml 包逐个验证）

frontmatter 的值是**未加引号的 YAML 纯量（plain scalar）**。纯量里出现下面两类字符会**破坏解析**：

| 字符 | 后果 | 例 |
|---|---|---|
| **半角冒号 + 空格** `': '` | 被当成嵌套映射 → `Nested mappings are not allowed in compact mappings` | `Spin up a squad**:** decide when` |
| **星号** `'*'` | 被当成 YAML alias 引用 → `Unresolved alias` | `做一个**商业项目**` |

**安全的字符**（实测无误）：全角冒号 `：`、全角括号 `（）`、箭头 `→`、反引号、双引号。

> 注意：报错里的 `line 2, column 14` 常常**误导**——真正的坏字符可能在同一条逻辑值的**很后面**。
> 别按行号找，**直接把值加引号**。

### 修复

**把 `description` 和 `whenToUse` 的值用双引号包起来**（引号内可安全包含 `: ` 和 `*`）：

```yaml
---
name: multi-agent-squad
description: "把一个大目标拆成多 agent 团队：……（Spin up a squad: decide when to spawn…）"
whenToUse: "任务规模超过单个上下文窗口时。"
---
```

转义规则（只在需要时）：
- 值里已有 `"` → 写成 `\"`
- 值里已有 `\` → 写成 `\\`
- **其余字符一律不用动**（中文、标点、`→` 都安全）

**改完立即生效**（实测：**无需重启**，技能当场出现在目录里）。

### 预防：写完技能必须跑体检器

参考库里带了体检器 **`validate-skills.mjs`**（位于 `<库根>\`）：

```powershell
cd <库根>
node validate-skills.mjs "%USERPROFILE%\.dsh\skills" "<库根>\engineering" "<库根>\productivity"
```

> ⚠️ **注意根的写法——这里有个容易搞错的地方**：
> 传给它的必须是**真正含技能的那一层**（`<根>/<name>/SKILL.md`）。
> **不要把库根 `<库根>` 当根传进去**——它下面只有 `engineering/` 和 `productivity/` 两个目录，
> **DSH 从它扫描会得到 0 个技能**（只认恰好两段路径）。
> 体检器会对此给出 **「DSH 可达性提醒」**，看到那条提醒就说明根传错了。

它用 **DSH 实际使用的同一个 yaml 包**逐个解析，并**复刻 DSH 的 `frontmatterBoolean`**，检查：

- YAML 能否解析（**最关键**——解析失败 = 整个技能被丢弃）
- `name` 是否存在、是否 kebab-case、**是否与目录名一致**
- `description` 是否存在、**是否超过 500 字符上限**（超出会被静默截断）
- 调用字段是否误写成**驼峰**（`disableModelInvocation` 等 → 整技能被丢弃）
- 调用字段值能否被 DSH 解析（**接受** `true/false`、`1/0`、`"1"/"0"`、`true/false/yes/no/on/off`；其余 → 整技能被丢弃）
- `whenToUse` —— 合法但**模型看不到**，会作为注意项提示
- **DSH 可达性**：根下若无直接 `SKILL.md`，会提醒"从该根扫描得到 0 个技能"

**判据：`0 个有致命问题` 才算过关**（退出码 0）。
实测当前：技能根 **10 个技能、0 致命问题**；`engineering` 18 个 + `productivity` 7 个同样通过。

> **纪律建议**：**每次新增或修改技能后必跑一次**。
> 这类错误**不会报错、不会崩溃，只会让技能静静地消失**——不主动体检就发现不了。
> 这与工作区铁律「**验证才算完成**」一致：没验证过的不许当装好了。

**常用参数**：

```powershell
node validate-skills.mjs --quiet   <根...>            # 只出退出码，适合 CI
node validate-skills.mjs --report out.txt <根...>     # 同时写报告文件（默认不写，避免只读目录失败）
```

---

## 九、临时停用技能的推荐做法：归档，而不是删除

**如果你想让某个技能"暂时不可用但还能找回来"**，建一个以 `_` 开头的归档目录，把技能目录整段移进去：

```
%USERPROFILE%\.dsh\skills\
├── _archive-gui-skills-20260912-164822\      ← 以 _ 开头，不会被当技能
│   ├── describe-screen\SKILL.md
│   └── ...                                    ← 注意：这是第 3 层，DSH 只认第 2 层
└── multi-agent-squad\SKILL.md                 ← 仍然正常可用
```

**为什么这样是安全的**（已核实源码 `dsh-skill-filesystem`）：
技能发现**只匹配恰好两段路径**（`<根>/<name>/SKILL.md`）。
归档目录里是 `<根>/_archive/<name>/SKILL.md`，**三段** → **不会被发现**，不会污染技能目录。

**好处**：`%USERPROFILE%\.dsh` **不是 git 仓库**，删掉就找不回来；归档等于零成本的保险。
**真要彻底删除**时，直接删归档目录即可。

> **停用技能的其他方式**：也可以保留技能文件、只在 frontmatter 加 `disable-model-invocation: true`（模型够不到，人还能敲）。
> 两者区别：**归档 = 完全不加载**；**加字段 = 你的 GUI 里还能用**。
