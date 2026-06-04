## 🛡️ Secure Enterprise AI Agent Pipeline (Text-to-SQL)

This project features an intelligent, production-grade **Text-to-SQL Chat Agent** built with Node.js, Express, AWS Bedrock (Meta Llama 3 70B), and Microsoft SQL Server (`mssql`). 

The backend architecture implements an **intent detection system** and a **Defense-in-Depth** security design to safely translate natural language user questions into read-only SQL queries against complex relational database environments.

---

### 🔄 How the Pipeline Works (`/chat` Endpoint)

When a user submits a prompt, the application coordinates an intelligent multi-turn orchestration framework:

#### 1. Intent Detection
Incoming prompts are scanned via regex for target sales and financial metrics keywords (e.g., *sales, order, revenue, total, due*). Standard queries fallback cleanly to conversational responses, completely bypassing the database layer.

#### 2. The 3-Way Agent Pipeline (Data Engine)
If a data lookup intent is confirmed, the application executes a strict **3-trip lifecycle**:

* **Trip 1: Context-Aware Schema Translation** The English query is bundled with a comprehensive definition of the database schema (encompassing tables across `Sales`, `Production`, `Person`, `HumanResources`, and `Purchasing` schemas from the **AdventureWorks2022** database). It interfaces with **Meta Llama 3 via AWS Bedrock** using strict prompt constraints and a deterministic `temperature: 0.0` configuration to generate precise T-SQL syntax.
* **Trip 2: Relational Query Execution**
  The system strips away any generated markdown code blocks, normalizes the root query, and runs it against the local Microsoft SQL Server instance to gather raw data records.
* **Trip 3: Conversational Data Synthesis**
  The raw datasets are packed back into an analytical response prompt. Llama 3 processes this underlying database context and crafts a single, fluid natural language summary for the browser interface—ensuring raw technical schemas or code blocks are never exposed to the end user.

---

### 🔒 Defense-in-Depth Security Framework

Allowing LLMs to generate text straight into an operational database poses substantial safety challenges. This engine relies on three distinct operational layers to achieve total threat containment:

#### Layer 1: Cloud-Based Security Parameters (AWS Bedrock Guardrails)
The initial request payload enforces configured AWS Bedrock cloud identifiers (`GUARDRAIL_ID` & `GUARDRAIL_VERSION`). If the user submits malicious prompt injections or hostile exploit payloads, AWS dynamically intercepts the workflow at the cloud boundary before local application execution takes place.

#### Layer 2: Structural Verification via Abstract Syntax Trees (AST Parsing)
Before passing any LLM output to the database client, the engine runs the query through `node-sql-parser` to unpack the text into an explicit mathematical AST structure. The app loops through the syntax array and programmatically verifies that **every individual statement is strictly a read-only `SELECT` operation**. If modifications, dropped schemas, or data manipulation definitions (`INSERT`, `UPDATE`, `DELETE`, etc.) are detected, the request is halted immediately.

#### Layer 3: Resilient Engine Error Interception
The engine wraps runtime execution with explicit database engine error handling. If an LLM hallucination targets non-existent database properties (such as error numbers `208` for missing tables or `207` for missing column structures), the software intercepts the exception, logs it securely to server-side telemetry, and surfaces a sterile error fallback statement.
