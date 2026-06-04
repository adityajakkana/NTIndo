## 🤖 Enterprise AI Agent Pipeline (Text-to-SQL)

This project features an intelligent **Text-to-SQL Chat Agent** built with Node.js, Express, AWS Bedrock (Meta Llama 3 70B), and Microsoft SQL Server (`mssql`). 

Instead of just answering basic conversational prompts, the backend includes an **intent detection system** that identifies when a user is asking for enterprise data and dynamically routes the request through a 3-turn multi-agent pipeline.

### 🔄 How the Pipeline Works (`/chat` Endpoint)

When a user sends a message, the server runs it through a conditional workflow:

#### 1. Intent Detection
The server scans the incoming message using a regex pattern to see if it targets sales keywords (e.g., *sales, order, revenue, total, due*). 

#### 2. The 3-Way Agent Pipeline (If Data is Requested)
If a sales intent is matched, the application orchestrates a **3-trip lifecycle**:
* **Trip 1: Natural Language to SQL Translation** The server feeds the user's natural English request along with your database schema (`Sales.SalesOrderHeader`) to **Meta Llama 3 (via AWS Bedrock)**. It enforces a strict code-generation format with `temperature: 0.0`. The server then cleans up the output, strips any markdown code blocks, runs a safety check to ensure it starts with a valid `SELECT` statement, and fixes common query hallucinations.
* **Trip 2: Database Execution** The dynamically generated SQL query is securely sent to your local Microsoft SQL Server (`AdventureWorks2022` database). The raw row-level data is fetched and returned as a JSON object.
* **Trip 3: Conversational Data Synthesis** The raw database results are packed into a final prompt and sent *back* to Llama 3 with a slightly higher temperature (`0.5`). The model interprets the data rows and formulates a natural, human-friendly conversational summary for the user—without ever mentioning SQL or raw database strings.

#### 3. Standard Fallback (If No Data is Requested)
If the user's intent is just regular conversation (e.g., *"Hello"*, *"How are you?"*), the pipeline skips the database entirely and passes the prompt directly to Llama 3 for a standard, fluid AI assistant response.

---

### 🛠️ Tech Stack & Architecture Highlights

* **Backend Framework:** Express.js running on port `8080`.
* **Database Integration:** `mssql` client connecting to a local instance configured for the `AdventureWorks2022` database.
* **LLM Orchestration:** `@aws-sdk/client-bedrock-runtime` using a Bearer Token setup to interface directly with `meta.llama3-70b-instruct-v1:0`.
* **Environment Safety:** Secured credentials loaded via `dotenv`. Includes strict server-side safeguards preventing the execution of non-`SELECT` database statements.
