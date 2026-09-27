# AI Simulated Patient — Dify API 協作與程式開發契約

> 文件用途：提供 ChatGPT、Codex 或其他 AI 程式開發工具直接閱讀，用於維護、擴充或除錯 AI Simulated Patient 專案的 Dify 整合。
>
> Repository: `hun186/AI-Simulated-Patient`  
> Authoritative baseline: `main @ 573eb81c90b332b9cee41bc753725982c7ab5e6a`  
> 文件版本基準日期：2026-09-27  
> 文件性質：Implementation Contract / AI Coding Guide  
>
> **重要：本文件描述的是平台目前已實作的契約，不是 Dify 的泛用教學。修改程式時應優先維持這些既有 invariants。**

---

## 0. 給 AI 開發者的最短版指示

如果你是接手此專案的 AI，先記住以下規則：

1. **平台是權威資料來源。**  
   使用者、角色、病例、interview session、canonical transcript、route snapshot、正式 evaluation、usage/audit 都由平台管理。

2. **Dify 可以保有 provider-specific conversation state，但不能取代平台 session。**

3. Dify 支援兩種 execution mode：
   - `platform_managed`
   - `stateful_chatflow`

4. `stateful_chatflow` **只能搭配 Dify Chat / Chatflow**，不能搭配 Workflow 或 Completion。

5. Stateful 第一次送出：
   ```json
   {
     "conversation_id": ""
   }
   ```
   Dify 回傳的 `conversation_id` 必須保存，之後同一 interview 重用。

6. Provider state 的 key 是：
   ```text
   (interview_session, Dify connection)
   ```
   不是只看學生，也不是只看病例。

7. 如果 Patient 與 Evaluator 要共享同一組 Dify Conversation Variables：
   **兩者必須使用同一個 Dify connection。**

8. 新 interview session **不得重用舊 session 的 `conversation_id`**。

9. Stateful Evaluator 可送 configurable final trigger，預設：
   ```text
   問診結束
   ```

10. Stateful Evaluator 如果要求 final trigger，但找不到既有 conversation state：
    **必須失敗**，不得偷偷建立新 Dify conversation。
    平台對外錯誤為：
    ```text
    DIFY_CONVERSATION_STATE_MISSING
    ```

11. Dify 的正式評量輸出必須符合平台既有 Evaluator JSON contract。  
    **不得另創 Dify-only assessment schema。**

12. Production 不得 silent fallback 到 Mock。

13. Dify API key 只存在 server side，且需加密保存；不得回傳 browser。

14. Vercel Demo 是 deterministic Mock / read-only preview，**不得存 Dify credential，也不得呼叫真實 Dify**。

15. 修改 Dify integration 前，至少閱讀：
    - `docs/DIFY_INTEGRATION_CONTRACT.md`
    - `docs/LLM_PROVIDERS.md`
    - `lib/llm/providers/dify.js`
    - `lib/llm/provider-state.js`
    - `lib/llm/routes.js`
    - `lib/llm/agents.js`
    - `lib/llm/evaluation-contract.js`
    - `api/evaluate.js`
    - `dify-stateful.integration.test.mjs`

---

# 1. 系統角色與責任邊界

## 1.1 Platform owns

平台是以下資訊的 authoritative source：

- user identity
- `admin / teacher / student` role
- Teacher → Student assignment
- case definition
- interview session lifecycle
- canonical transcript
- Patient / Coach / Evaluator route snapshot
- completed evaluation
- usage records
- audit records
- report export
- student report-download policy

即使 Stateful Dify Chatflow 內部也保存 Conversation Variables，正式歷史仍以平台資料為準。

## 1.2 Dify may own

依 App 類型與 execution mode，Dify 可負責：

- Patient LLM response
- Coach workflow
- Evaluator workflow
- Chatflow branching
- Dify Conversation Variables
- Stateful scoring flags，例如：
  ```text
  H01_done
  H02_done
  ...
  H14_done
  ```
- Dify 內部 LLM model / workflow orchestration
- 最終評量 JSON 的生成

但 Dify 不應成為：

- platform user database
- platform interview database
- canonical transcript database
- final report database
- authentication system

---

# 2. 整體架構

```text
Browser
  │
  │ platform API
  ▼
AI Simulated Patient server
  │
  ├─ Auth / RBAC / CSRF
  ├─ Case service
  ├─ Interview session
  ├─ Canonical transcript
  ├─ Route snapshot
  ├─ Provider-state persistence
  ├─ Evaluation validation / repair
  └─ Usage / audit
        │
        │ server-side Bearer App API key
        ▼
      Dify API
        │
        ├─ Chat / Chatflow
        ├─ Workflow
        └─ Completion
```

Browser **不直接呼叫 Dify**。

Dify App API key **不應出現在 frontend JavaScript、localStorage、URL 或 report**。

---

# 3. Dify connection contract

平台把一個 Dify connection 視為：

```text
一個 published Dify App API key
+
一個 Dify API base URL
+
一個 App mode
```

Logical fields：

```json
{
  "name": "My Dify Patient",
  "preset": "dify",
  "baseUrl": "https://api.dify.ai/v1",
  "defaultModel": "chat",
  "apiKey": "app-..."
}
```

`defaultModel` 對 Dify 的意義不是 LLM model 名稱，而是 Dify App mode。

允許值：

```text
chat
workflow
completion
```

對應：

| Logical mode | Dify endpoint |
|---|---|
| `chat` | `POST /chat-messages` |
| `workflow` | `POST /workflows/run` |
| `completion` | `POST /completion-messages` |

預設 Base URL：

```text
https://api.dify.ai/v1
```

## 3.1 Internal-storage compatibility note

目前實作為了相容既有 schema，在 database 內部可能將 Dify 連線保存為：

```text
stored preset = custom
stored provider kind = openai_compatible
stored default_model = dify::<mode>
```

例如：

```text
dify::chat
```

但 public/logical DTO 會轉回：

```json
{
  "preset": "dify",
  "providerKind": "dify",
  "defaultModel": "chat"
}
```

**新程式不可直接依賴上述內部 storage encoding 作為 public contract。**

應使用 `connections.js` / route DTO 的 logical representation。

---

# 4. Connection security

## 4.1 API key

Dify requires App API key。

平台要求：

```text
LLM_SECRET_MASTER_KEY=<32-byte key encoded as base64>
```

Provider credentials 使用 AES-256-GCM 加密保存。

Browser 查詢 connection 時只可看到類似：

```json
{
  "apiKeyLast4": "1234"
}
```

不得回傳完整 key。

## 4.2 Endpoint policy

Teacher 可使用：

```text
https://api.dify.ai
```

或允許的 private/local network Dify host。

Teacher 不可藉 Dify connection 任意呼叫公網任意 URL。

Admin 擁有較廣的 endpoint 管理權限。

## 4.3 Vercel Demo

Vercel public PoC：

- 不保存 production Dify key
- 不呼叫真實 Dify
- AI Settings 僅為 read-only product preview
- runtime 保持 deterministic Mock

不要為了「讓 Vercel demo 看起來能用」而把 credential 暴露到 browser。

---

# 5. Connection test

平台測試 Dify connection 使用：

```http
GET <baseUrl>/parameters?user=aisp-connection-test
Authorization: Bearer <APP_API_KEY>
```

目的：

- 驗證 endpoint
- 驗證 App API key
- 避免產生真正 Patient / Coach / Evaluator response

成功後 logical result 類似：

```json
{
  "ok": true,
  "provider": "dify",
  "preset": "dify",
  "model": "chat",
  "latencyMs": 120
}
```

Connection test **不是** interview runtime test。

---

# 6. Route model

三個 Agent route 相互獨立：

```text
Patient
Coach
Evaluator
```

route 在 interview session 建立時會 snapshot。

因此 session 開始後即使教師修改 AI Settings，既有 session 的 Provider / Model / route config 不應被偷偷改變。

Snapshot 內容概念上包含：

```json
{
  "routeId": "...",
  "connectionId": "...",
  "providerKind": "dify",
  "preset": "dify",
  "model": "chat",
  "config": {}
}
```

Provider API secret **不會**複製到 session snapshot。

---

# 7. Dify route config schema

Dify-specific route config 可包含：

```json
{
  "difyExecutionMode": "platform_managed",
  "difyInputKey": "prompt",
  "difyOutputKey": "text",
  "difyInputs": {},
  "difyFinalTriggerEnabled": false,
  "difyFinalTrigger": "問診結束"
}
```

## 7.1 `difyExecutionMode`

允許：

```text
platform_managed
stateful_chatflow
```

預設：

```text
platform_managed
```

`stateful_chatflow` 僅允許 Dify `chat` mode。

錯誤設定應回：

```text
INVALID_DIFY_STATEFUL_APP_MODE
```

而不是自動降級為 stateless。

## 7.2 `difyInputKey`

Workflow 使用。

預設：

```text
prompt
```

用途：指定 combined platform prompt 寫入哪個 Workflow input variable。

## 7.3 `difyOutputKey`

Workflow 使用。

預設：

```text
text
```

用途：從 Workflow outputs 中選哪個欄位作為 agent response。

若指定 key 無可用字串，adapter 會尋找第一個非空 string output。

## 7.4 `difyInputs`

固定 inputs object。

例如：

```json
{
  "language": "zh-TW",
  "course": "voice-disorders"
}
```

必須是 JSON object，不能是 array。

錯誤：

```text
INVALID_DIFY_INPUTS
```

## 7.5 `difyFinalTriggerEnabled`

只允許 Evaluator route 啟用。

Patient 或 Coach route 若啟用應視為 invalid config。

## 7.6 `difyFinalTrigger`

預設：

```text
問診結束
```

目前 route validation 最長保留 200 characters。

---

# 8. Execution Mode A — Platform-managed

## 8.1 使用情境

適合：

- Dify Workflow
- Dify Completion
- 不依賴 Conversation Variables 的 Chat / Chatflow
- 希望平台每次提供完整 context

## 8.2 核心原則

平台把：

- locked system prompt
- transcript / messages
- agent instruction

組合成 `combinedPrompt`。

Dify 不需要依賴上一次 provider conversation。

## 8.3 Chat request

概念：

```http
POST /chat-messages
Authorization: Bearer <APP_API_KEY>
Content-Type: application/json
```

```json
{
  "inputs": {},
  "query": "SYSTEM INSTRUCTIONS:\n...\n\nUSER:\n...\n\nASSISTANT:\n...",
  "response_mode": "blocking",
  "user": "aisp_<opaque hash>",
  "conversation_id": ""
}
```

在 `platform_managed` 模式，`conversation_id` 不作為平台 continuity contract。

## 8.4 Workflow request

```http
POST /workflows/run
```

預設：

```json
{
  "inputs": {
    "prompt": "<combined platform prompt>"
  },
  "response_mode": "blocking",
  "user": "aisp_<opaque hash>"
}
```

若：

```json
{
  "difyInputKey": "agent_prompt",
  "difyInputs": {
    "language": "zh-TW"
  }
}
```

則：

```json
{
  "inputs": {
    "language": "zh-TW",
    "agent_prompt": "<combined platform prompt>"
  },
  "response_mode": "blocking",
  "user": "aisp_<opaque hash>"
}
```

## 8.5 Workflow response

平台優先尋找：

```text
data.outputs[difyOutputKey]
```

預設：

```text
data.outputs.text
```

若 preferred key 不是 string，會尋找 outputs 內第一個非空 string。

## 8.6 Completion request

```http
POST /completion-messages
```

概念：

```json
{
  "inputs": {},
  "query": "<combined platform prompt>",
  "response_mode": "blocking",
  "user": "aisp_<opaque hash>"
}
```

---

# 9. Execution Mode B — Stateful Chatflow

## 9.1 使用情境

適合既有 Dify Chatflow 已使用：

```text
Conversation Variables
```

例如：

```text
H01_done
H02_done
...
H14_done
```

或其他需要 Dify conversation continuity 的 state。

## 9.2 限制

Stateful execution：

```text
Dify mode MUST be chat
```

不可套在：

```text
workflow
completion
```

## 9.3 第一輪

平台尚無 state：

```json
{
  "query": "學生第一輪訊息",
  "conversation_id": "",
  "user": "aisp_<stable opaque id>",
  "inputs": {},
  "response_mode": "blocking"
}
```

Dify 回：

```json
{
  "message_id": "...",
  "conversation_id": "conv-abc123",
  "answer": "病人回答..."
}
```

平台保存：

```json
{
  "conversationId": "conv-abc123"
}
```

到 provider session state。

## 9.4 後續輪次

```json
{
  "query": "學生下一輪訊息",
  "conversation_id": "conv-abc123",
  "user": "同一 stable opaque id",
  "inputs": {},
  "response_mode": "blocking"
}
```

此時 Dify Conversation Variables 可繼續累積。

## 9.5 Provider state persistence

Database 概念：

```text
llm_provider_session_state
```

key：

```text
session_id
connection_id
```

state JSON：

```json
{
  "conversationId": "conv-abc123"
}
```

provider kind：

```text
dify
```

### 不要改成以下錯誤做法

錯誤：

```text
key by student only
key by case only
key by route type only
global Dify conversation_id
```

因為同一學生可能同時／先後執行多個 interview，而每場 session 必須隔離。

---

# 10. Patient 與 Stateful Chatflow

正常 Student 問話時，Stateful Patient route 只送「本輪 user query」給 Dify，而不是每輪重送完整 transcript。

這是刻意行為，因為 Stateful Dify App 自己保有 conversation state。

例如：

```json
{
  "query": "你的聲音沙啞多久了？",
  "conversation_id": "conv-abc123"
}
```

正常 Dify answer 不需要包自訂 frontend envelope：

```text
大概半年多了，一開始只是偶爾沙啞，後來越來越明顯。
```

平台 adapter 從：

```json
{
  "answer": "..."
}
```

取得 Patient reply。

---

# 11. End-of-interview / Evaluator Stateful contract

## 11.1 目的

某些既有 Chatflow 在每一輪更新 H01-H14 variables，直到學生按下「結束問診／查看結果」才進入最終評量 branch。

概念：

```text
IF query == "問診結束"
    -> final evaluation
ELSE
    -> patient reply
    -> update H01_done ... H14_done
```

## 11.2 Route config

Evaluator route：

```json
{
  "difyExecutionMode": "stateful_chatflow",
  "difyFinalTriggerEnabled": true,
  "difyFinalTrigger": "問診結束"
}
```

**Patient 與 Evaluator 必須指向同一 Dify connection**，才能讀到同一筆：

```text
(session_id, connection_id)
```

state。

## 11.3 Final request

```json
{
  "query": "問診結束",
  "conversation_id": "conv-abc123",
  "user": "same stable opaque id",
  "inputs": {},
  "response_mode": "blocking"
}
```

## 11.4 Missing state

如果 final trigger 啟用，但該 `(session, connection)` 沒有 conversation ID：

adapter error：

```text
dify_conversation_state_missing
```

platform evaluation API 對外：

```http
409 Conflict
```

```json
{
  "error": "DIFY_CONVERSATION_STATE_MISSING"
}
```

**禁止做以下 fallback：**

```text
conversation_id = ""
然後開一個新 Dify conversation 做 final evaluation
```

這樣會丟失 Conversation Variables，評量結果會失真。

---

# 12. 新 session 隔離

當學生建立第二場 interview：

```text
Session A -> conv-1
Session B -> initially no conversation_id
```

即使：

- 同一學生
- 同一病例
- 同一 Dify connection

也不得變成：

```text
Session B -> conv-1
```

第二場第一輪必須：

```json
{
  "conversation_id": ""
}
```

由 Dify 建立新的 conversation。

這項行為已有 integration test。

---

# 13. Dify Evaluator output contract

Dify 最終評量 **必須**輸出平台既有 Evaluator contract。

## 13.1 Required shape

```json
{
  "totalScore": 11,
  "maxScore": 14,
  "percentage": 78.6,
  "items": [
    {
      "id": "H01",
      "criterion": "主訴",
      "status": "covered",
      "score": 1,
      "maxScore": 1,
      "evidence": [
        {
          "turn": 2,
          "quote": "你的聲音主要有什麼困擾？"
        }
      ],
      "reasoning": "學生有明確詢問主要嗓音困擾。"
    }
  ],
  "overall": {
    "comment": "整體評語",
    "strengths": [
      "能有系統地詢問主要症狀。"
    ],
    "improvements": [
      "可再補充症狀誘發因素。"
    ],
    "recommendations": [
      "下一次可使用時間軸方式整理病史。"
    ],
    "nextPracticeFocus": "加強症狀時間與影響因素的追問"
  }
}
```

## 13.2 Allowed item status

只能：

```text
covered
partial
missed
```

不要輸出：

```text
done
not_done
pass
fail
yes
no
complete
```

除非先在 Dify 內部轉換成正式 contract。

## 13.3 Validation rules

平台會檢查：

- `totalScore` finite number，>= 0
- `maxScore` finite number，>= 0
- `totalScore <= maxScore`
- `percentage` 0..100
- `items` 必須 array
- 每個 item：
  - `id`: non-empty string
  - `criterion`: non-empty string
  - `status`: `covered|partial|missed`
  - `score`: number >= 0
  - `maxScore`: number >= 0
  - `score <= maxScore`
  - `evidence`: array
  - evidence `turn`: positive integer
  - evidence `quote`: string
  - `reasoning`: string
- `overall.comment`: string
- `overall.strengths`: string[]
- `overall.improvements`: string[]
- `overall.recommendations`: string[]
- `overall.nextPracticeFocus`: string

## 13.4 JSON parsing tolerance

平台可接受：

- raw JSON
- fenced ```json block
- 文字中可辨識的第一個 `{ ... }` JSON object

但這只是容錯。

**推薦 Dify final output 只回純 JSON，不要附前後說明。**

---

# 14. 不要建立第二套 Dify assessment schema

舊設計曾有：

```text
score
total
completed_items
missing_items
strengths
priority_improvements
practice_suggestions
next_focus
```

不要把這個 shape 當新的正式 contract。

如果既有 Chatflow 內部仍使用這些變數，可在最後一個 node 轉換成平台 contract。

例如概念映射：

```text
score                   -> totalScore
total                   -> maxScore
score / total * 100     -> percentage
completed/missing items -> items[]
strengths               -> overall.strengths
priority_improvements   -> overall.improvements
practice_suggestions    -> overall.recommendations
next_focus              -> overall.nextPracticeFocus
```

但正式 API output 仍只有平台 contract。

---

# 15. Evaluation repair behavior

Evaluator output 若不能通過 validation：

```text
INVALID_EVALUATION_CONTRACT
```

平台存在 repair path。

一般 Provider 會取得：

```text
previous invalid output
+
validation failure
+
repair instructions
```

並再呼叫一次。

對 **Stateful Dify final-trigger route**，repair 仍會以同一 final trigger 與同一 conversation state 執行。

因此 Dify Chatflow 的 final branch 應盡可能 deterministic 地輸出合法 JSON。

若 repair 後仍不合法：

```text
EVALUATION_REPAIR_FAILED
```

session 不應被標記為 completed。

---

# 16. Interview completion invariant

只有：

```text
Evaluator output valid
+
evaluation persisted
```

之後，interview 才應進入：

```text
completed
```

以下情況都不應偽造完成：

- Provider timeout
- invalid Dify response
- missing Stateful conversation
- invalid Evaluator JSON
- quota exceeded
- upstream 5xx

Evaluator failure 時，session 保持可重試狀態。

---

# 17. Dify usage accounting

Adapter 會嘗試讀：

```text
metadata.usage
usage
data.usage
```

Token fields 支援概念上：

```text
prompt_tokens
input_tokens
completion_tokens
output_tokens
prompt_cache_hit_tokens
cached_input_tokens
reasoning_tokens
total_tokens
```

若 Provider 有回 usage：

```text
usageStatus = reported
```

沒有：

```text
usageStatus = unreported
```

不要把 missing usage 當成：

```text
exactly 0 tokens
```

## 17.1 Cost

Dify 內部實際 model 與 billing 可能由 Dify App/workflow 決定。

因此平台目前：

**不應憑空套用 OpenAI / DeepSeek 原生價格到 Dify call。**

沒有 dedicated pricing policy 時：

```text
unpriced
```

是正確狀態。

---

# 18. Provider request identity

Dify provider request id 可取自：

```text
message_id
workflow_run_id
data.id
task_id
```

供 usage / diagnostics 使用。

不要將 request ID 當作 platform session ID。

---

# 19. Timeout 與 blocking mode

目前 Dify adapter 使用：

```json
{
  "response_mode": "blocking"
}
```

一般 runtime timeout default：

```text
60000 ms
```

可由 route config 的：

```text
timeoutMs
timeout_ms
```

覆寫。

Connection test timeout：

```text
10000 ms
```

若 Abort：

```text
timeout
```

Evaluation API 映射：

```http
504
```

```json
{
  "error": "AI_PROVIDER_TIMEOUT"
}
```

---

# 20. Provider error normalization

常見 normalized provider code：

| Provider code | 意義 |
|---|---|
| `authentication_failed` | API key / auth failure |
| `endpoint_unreachable` | endpoint unavailable / upstream 5xx |
| `model_not_found` | upstream 404 |
| `invalid_request` | upstream 400 / 422 |
| `insufficient_balance` | upstream 402 |
| `rate_limited` | upstream 429 |
| `invalid_response` | response JSON 或 required output 不合法 |
| `timeout` | request timeout |
| `dify_conversation_state_missing` | Stateful final trigger 缺 conversation state |

Evaluator API 會進一步轉為平台 API error，例如：

```text
AI_EVALUATOR_PROVIDER_NOT_CONFIGURED
DIFY_CONVERSATION_STATE_MISSING
AI_PROVIDER_TIMEOUT
AI_PROVIDER_FAILURE
AI_USAGE_QUOTA_EXCEEDED
```

不要把 upstream 原始 secret/error body 直接透傳 browser。

---

# 21. Stable Dify `user`

平台傳給 Dify 的 `user` 不是 email，也不是姓名。

目前由 platform student/user identifier 做 SHA-256 後截取，概念：

```text
aisp_<opaque hash>
```

目標：

- 對同一平台使用者穩定
- 不直接暴露 email / internal user ID
- 可符合 Dify user field requirement

Stateful continuity 的真正關鍵仍是：

```text
conversation_id
```

不是 `user` 本身。

---

# 22. Teacher/Admin AI Settings platform API

平台 AI Settings endpoint：

```text
/api/teacher/ai-settings
```

僅：

```text
teacher
admin
```

可用。

Production database mode 必須啟用。

Authenticated unsafe POST 需要 CSRF。

## 22.1 GET

```http
GET /api/teacher/ai-settings
```

回：

```json
{
  "connections": [],
  "routes": [],
  "actorRole": "teacher",
  "promptTemplates": {}
}
```

## 22.2 Create Dify connection

概念 request：

```json
{
  "action": "createConnection",
  "name": "Voice Case Dify",
  "preset": "dify",
  "baseUrl": "https://api.dify.ai/v1",
  "defaultModel": "chat",
  "apiKey": "app-..."
}
```

## 22.3 Test connection

```json
{
  "action": "testConnection",
  "connectionId": "<connection-id>"
}
```

## 22.4 Set case Patient route

```json
{
  "action": "setCaseRoute",
  "caseId": "<case-id>",
  "agentType": "patient",
  "connectionId": "<dify-connection-id>",
  "model": "chat",
  "config": {
    "difyExecutionMode": "stateful_chatflow"
  }
}
```

## 22.5 Set Stateful Evaluator route

```json
{
  "action": "setCaseRoute",
  "caseId": "<case-id>",
  "agentType": "evaluator",
  "connectionId": "<same-dify-connection-id>",
  "model": "chat",
  "config": {
    "difyExecutionMode": "stateful_chatflow",
    "difyFinalTriggerEnabled": true,
    "difyFinalTrigger": "問診結束"
  }
}
```

上述 Patient/Evaluator 的 `connectionId` 必須相同，若設計目的是共享同一 Dify Conversation Variables。

---

# 23. Platform route validation errors

AI Settings 常見 400-level contract errors：

```text
INVALID_PRESET
INVALID_BASE_URL
BASE_URL_REQUIRED
DIFY_ENDPOINT_NOT_ALLOWED
INVALID_DIFY_APP_MODE
INVALID_DIFY_EXECUTION_MODE
INVALID_DIFY_ROUTE_CONFIG
INVALID_DIFY_STATEFUL_APP_MODE
INVALID_DIFY_FINAL_TRIGGER
INVALID_DIFY_INPUTS
API_KEY_REQUIRED
NAME_REQUIRED
MODEL_REQUIRED
INVALID_AGENT_TYPE
INVALID_PROMPT_TEMPLATE
PROMPT_TEMPLATE_TOO_LONG
UNSUPPORTED_PROMPT_VARIABLE
```

Permissions：

```text
FORBIDDEN
FORBIDDEN_PRESET
FORBIDDEN_CONNECTION
FORBIDDEN_CASE
```

404：

```text
CONNECTION_NOT_FOUND
ROUTE_NOT_FOUND
CASE_NOT_FOUND
```

---

# 24. Worked example — H01-H14 Stateful Chatflow

假設既有 Dify Chatflow：

```text
Conversation Variables:
H01_done = false
...
H14_done = false
```

普通問診 branch：

```text
Student query
  │
  ├─ classify covered rubric items
  ├─ update Hxx_done
  └─ generate Patient reply
```

Final branch：

```text
query == "問診結束"
  │
  ├─ read H01_done ... H14_done
  ├─ combine transcript/state as needed
  ├─ calculate item scores
  └─ emit platform Evaluator JSON
```

平台設定：

### Connection

```text
preset: dify
mode: chat
```

### Patient

```json
{
  "difyExecutionMode": "stateful_chatflow"
}
```

### Evaluator

同一 connection：

```json
{
  "difyExecutionMode": "stateful_chatflow",
  "difyFinalTriggerEnabled": true,
  "difyFinalTrigger": "問診結束"
}
```

Runtime：

```text
Session create
  │
  ▼
Student Q1
  -> conversation_id=""
  <- conv-1 + Patient A1
  -> platform saves conv-1
  │
Student Q2
  -> conversation_id=conv-1
  <- Patient A2
  │
...
  │
End interview
  -> query="問診結束"
  -> conversation_id=conv-1
  <- Evaluator JSON
  │
platform validates JSON
  │
valid
  ▼
persist evaluation
mark session completed
```

---

# 25. Dify Chatflow final-node recommendation

Final node 最理想只輸出 JSON：

```json
{
  "totalScore": 0,
  "maxScore": 14,
  "percentage": 0,
  "items": [],
  "overall": {
    "comment": "",
    "strengths": [],
    "improvements": [],
    "recommendations": [],
    "nextPracticeFocus": ""
  }
}
```

實際 production 當然要填完整 `items`。

不要輸出：

```text
以下是評量結果：
{ ...json... }
希望這份結果有幫助！
```

雖然平台 parser 有容錯，但純 JSON 最穩定。

---

# 26. Evidence / transcript rule

Evaluator evidence：

```json
{
  "turn": 2,
  "quote": "你的聲音主要有什麼困擾？"
}
```

應對應真實 canonical transcript。

不要由 Dify 生成不存在的學生問句當 evidence。

即使 Conversation Variables 已標記：

```text
H01_done=true
```

正式 explanation/evidence 仍應能與 canonical transcript 相符。

平台的正式報告會使用 persisted assessment + canonical transcript，因此兩者應保持一致。

---

# 27. Coach 與 Dify

Coach 也可使用 Dify route，但：

- Coach 是獨立 Agent role
- Training only
- Exam 不使用 Coach
- Coach 不應洩漏 hidden case answers / rubric answers
- Coach output 不得改寫 canonical Patient transcript

Stateful Chatflow 最主要既有 compatibility target 是 Patient + final Evaluator。

若要讓 Coach 共用 state，需先清楚定義其 provider-state semantics；不要默認所有 Agent 都應共用同一 connection state。

---

# 28. Production fallback rule

Production database mode：

```text
NO silent Mock fallback
```

例如：

Patient route 缺失：

```text
session creation / execution should fail clearly
```

Patient Dify failure：

```text
do not persist a fake Patient reply
```

Evaluator failure：

```text
do not fabricate evaluation
do not mark session completed
```

Mock 僅可存在於明確 development/demo path。

---

# 29. Security invariants for AI-generated code

AI 修改 Dify integration 時必須逐條確認：

- [ ] API key 不進 browser
- [ ] API key 不進 report
- [ ] API key 不進 route snapshot
- [ ] API key encrypted at rest
- [ ] full key 不由 GET API 回傳
- [ ] upstream secret response 不直接透傳
- [ ] Teacher endpoint policy 未被繞過
- [ ] Vercel demo 未開始呼叫 real Dify
- [ ] session ownership 仍由 platform API 檢查
- [ ] CSRF 邏輯未被跳過
- [ ] Dify `conversation_id` 不跨 interview session
- [ ] final evaluator 不會因 missing state 偷開新 conversation

---

# 30. Data-integrity invariants

- [ ] Canonical transcript remains platform-owned.
- [ ] Route snapshot remains immutable for the session.
- [ ] Provider state is subordinate state.
- [ ] Dify Conversation Variables are not the only persisted assessment evidence.
- [ ] Final evaluation must pass platform validator.
- [ ] Completed status occurs only after valid evaluation persistence.
- [ ] New session starts without previous Dify conversation state.
- [ ] Patient/Evaluator shared-state flow uses the same connection ID.
- [ ] Provider failure does not create fake transcript content.

---

# 31. Required regression tests when modifying Stateful Dify

至少應保留／擴充以下情境：

## Test A — first turn

Expect:

```text
conversation_id == ""
```

and Dify returns:

```text
conv-1
```

platform persists:

```json
{"conversationId":"conv-1"}
```

## Test B — second turn

Expect:

```text
conversation_id == "conv-1"
```

## Test C — final trigger

Expect:

```text
query == "問診結束"
conversation_id == "conv-1"
```

## Test D — complete evaluation

Expect：

```text
valid Evaluator JSON
session.status == completed
evaluation row persisted
```

## Test E — new session

Expect：

```text
new session first request conversation_id == ""
```

not:

```text
conv-1
```

## Test F — final trigger missing state

Expect：

```http
409
```

```json
{
  "error": "DIFY_CONVERSATION_STATE_MISSING"
}
```

## Test G — different Patient/Evaluator connection

If Stateful Evaluator expects Patient variables but uses a different connection, the implementation must not accidentally fetch state from another connection.

## Test H — invalid final JSON

Expect:

```text
validation / repair path
```

and no false completed status.

---

# 32. Existing authoritative regression test

Repository：

```text
dify-stateful.integration.test.mjs
```

目前測試已驗證：

1. 第一輪送空 `conversation_id`
2. Dify 回 `conv-1`
3. platform DB 保存 `{"conversationId":"conv-1"}`
4. 第二輪重用 `conv-1`
5. final trigger `問診結束` 重用 `conv-1`
6. final evaluation 通過後 session `completed`
7. evaluation row 寫入
8. 第二個 interview session 第一輪重新送空 `conversation_id`

修改 Stateful Dify code 不應讓此 regression test 失效。

---

# 33. Source map

| Contract | Primary source |
|---|---|
| Dify overall contract | `docs/DIFY_INTEGRATION_CONTRACT.md` |
| Provider overview | `docs/LLM_PROVIDERS.md` |
| Dify HTTP adapter | `lib/llm/providers/dify.js` |
| Dify connection validation | `lib/llm/connections.js` |
| Route config validation | `lib/llm/routes.js` |
| Provider state persistence | `lib/llm/provider-state.js` |
| Patient / Coach / Evaluator request construction | `lib/llm/agents.js` |
| Evaluation JSON validation | `lib/llm/evaluation-contract.js` |
| Evaluation lifecycle / repair / API error mapping | `api/evaluate.js` |
| Teacher/Admin AI settings API | `api/teacher/ai-settings.js` |
| Stateful E2E regression | `dify-stateful.integration.test.mjs` |

---

# 34. AI implementation workflow

當 AI 被要求「修改 Dify」時，推薦流程：

```text
1. Read current hosted main
2. Read this contract
3. Read DIFY_INTEGRATION_CONTRACT.md
4. Read actual adapter/routes/provider-state/evaluation code
5. Identify requested behavior
6. Preserve platform ownership boundaries
7. Implement minimal compatible change
8. Add/update regression tests
9. Run relevant Dify + LLM + session tests
10. Review actual diff
11. Only then prepare PR
```

不要只根據先前 ChatGPT/Codex completion report 判斷程式現況。

Hosted code 是 authority。

---

# 35. AI anti-patterns

## 35.1 不要把 Dify conversation 當 platform session

錯誤：

```text
platform session id = Dify conversation_id
```

兩者生命週期與責任不同。

## 35.2 不要在 browser 保存 Dify key

錯誤：

```javascript
localStorage.setItem("difyKey", ...)
```

## 35.3 不要每輪 Stateful call 都把 conversation_id 清空

會讓 Conversation Variables 完全失效。

## 35.4 不要跨 session 共用 conversation_id

會污染不同學生／不同場次狀態。

## 35.5 不要 final trigger 時開新 conversation

會遺失 H01-H14 等狀態。

## 35.6 不要另外做一個 Dify results UI schema

正式評量應進入平台既有 Evaluator contract 與 report pipeline。

## 35.7 不要相信 frontend 隱藏就是 authorization

所有 route / connection / student/session scope 必須 server-side validate。

## 35.8 不要 silent fallback

Production Dify 掛掉就應呈現 sanitized failure，而不是 Mock 假裝成功。

---

# 36. 後續擴充原則

若未來要擴充：

- streaming Dify response
- Workflow external state
- Dify knowledge-base controls
- files / audio input
- multiple Dify conversations per platform session
- explicit provider state migration
- Dify-specific pricing

應：

1. 保持 canonical platform session 不變。
2. provider state 仍使用明確 namespace/key。
3. 不破壞既有 `platform_managed`。
4. 不破壞既有 `stateful_chatflow`。
5. 加 schema migration，而非偷偷改既有 state shape。
6. 新增 regression tests。
7. 若改 public contract，同步更新：
   - `docs/DIFY_INTEGRATION_CONTRACT.md`
   - `docs/LLM_PROVIDERS.md`
   - 本 AI 協作文件

---

# 37. 最終 Contract Summary

```text
Platform owns the interview.
Dify may own provider-side conversational state.

Dify connection:
  preset = dify
  mode = chat | workflow | completion

Execution:
  platform_managed
  stateful_chatflow (chat only)

Stateful key:
  interview_session + connection

First Chatflow turn:
  conversation_id = ""

Later turns:
  reuse returned conversation_id

Patient + Stateful Evaluator:
  must use same Dify connection to share Conversation Variables

Final trigger:
  configurable
  default = "問診結束"

Missing final state:
  fail with DIFY_CONVERSATION_STATE_MISSING
  never silently create a new conversation

Final assessment:
  must conform to platform Evaluator JSON contract

Production:
  no silent Mock fallback

Security:
  Dify key server-side only
  encrypted at rest
  never exposed to browser

Vercel Demo:
  deterministic Mock / read-only preview
  no real Dify credentials or calls
```

---

# Appendix A — Minimal Stateful Patient request/response

Request:

```http
POST https://api.dify.ai/v1/chat-messages
Authorization: Bearer app-REDACTED
Content-Type: application/json
```

```json
{
  "inputs": {},
  "query": "你的聲音什麼時候開始沙啞？",
  "response_mode": "blocking",
  "user": "aisp_0123456789abcdef0123456789abcdef",
  "conversation_id": ""
}
```

Response:

```json
{
  "message_id": "msg-1",
  "conversation_id": "conv-1",
  "answer": "大約半年以前開始的。",
  "metadata": {
    "usage": {
      "prompt_tokens": 100,
      "completion_tokens": 20,
      "total_tokens": 120
    }
  }
}
```

Platform saves only provider state needed for continuity:

```json
{
  "conversationId": "conv-1"
}
```

Canonical Student/Patient transcript is persisted separately by the platform.

---

# Appendix B — Minimal final trigger

```json
{
  "inputs": {},
  "query": "問診結束",
  "response_mode": "blocking",
  "user": "aisp_0123456789abcdef0123456789abcdef",
  "conversation_id": "conv-1"
}
```

Expected `answer` content: valid platform Evaluator JSON.

---

# Appendix C — Machine-facing handoff prompt

When handing this project to another AI, the following short instruction can be appended:

> Treat `main` hosted code as authority. Preserve the Dify contract in `AISP_Dify_API_Guide.md`. Do not redesign state ownership. The platform owns canonical session/transcript/evaluation. `stateful_chatflow` is Chat-only; persist Dify `conversation_id` per `(session, connection)`; Patient and Evaluator must use the same Dify connection when sharing Conversation Variables; final trigger defaults to `問診結束`; missing final state must return `DIFY_CONVERSATION_STATE_MISSING`; final Dify output must pass the existing Evaluator JSON contract; production must never silently fall back to Mock. Review actual diffs and regression tests before proposing merge.
