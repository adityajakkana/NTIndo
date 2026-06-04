const express = require('express');
const path = require('path');
const app = express();
const PORT = 8080;

// Middleware to parse JSON bodies from our frontend
app.use(express.json());

// Serve static files (like your index.html) from the current directory
app.use(express.static(__dirname,{ index: false })); 

const sql = require('mssql');

// Database configuration
const sqlConfig = {
    user: 'sa1', 
    password: '123', 
    server: 'localhost',
    database: 'AdventureWorks2022',
    options: {
        encrypt: false, 
        trustServerCertificate: true, 
       // trustedConnection: true
    }
};
sql.on('error', err => {
    console.error('GLOBAL SQL ERROR:', err);
});
async function executeSQL(query) {
    try {
        await sql.connect(sqlConfig);
        const result = await sql.query(query);
        return result.recordset; // Returns just the raw data rows
    } catch (err) {
        console.error('SQL Execution Error:', err);
        return { error: err.message };
    }
}

require('dotenv').config();
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Initialize the Bedrock client using your Bearer Token
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION,
    token: {
        token: process.env.AWS_BEARER_TOKEN_BEDROCK
    }
});

const { Parser } = require('node-sql-parser');
const sqlParser = new Parser();

// --- SECURITY VALIDATION FUNCTION ---
function validateSQLSecurity(sqlQuery) {
    try {
        // Parse the query into an Abstract Syntax Tree (AST)
        const ast = sqlParser.astify(sqlQuery);
        const statements = Array.isArray(ast) ? ast : [ast];
        
        for (const stmt of statements) {
            // Strictly enforce read-only operations
            if (stmt.type !== 'select') {
                return { safe: false, reason: `Forbidden operation type: ${stmt.type}` };
            }
        }
        return { safe: true };
    } catch (err) {
        return { safe: false, reason: "Malformed SQL syntax failed AST parsing." };
    }
}

const LLAMA_MODEL_ID = "meta.llama3-70b-instruct-v1:0";
//const CLAUDE_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
// The Chat API Endpoint
app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    //const jetsonIP = 'jestsoniphere';//put jetson ips address here
    //const modelName = 'tinyllama:latest'; // Using your optimized memory-safe model!
    try {
        // 1. SQL INTENT DETECTION
        if (userMessage.toLowerCase().match(/(sales|order|revenue|total|due)/)) {
            
            // --- TRIP 1: Translate English into SQL (Claude Format) ---
            const schemaPrompt = `You are an expert enterprise SQL translator. Output ONLY a single valid Microsoft SQL Server SELECT statement statement based on the user's natural language question. Do NOT include markdown blocks, code fences like \`\`\`sql, or explanatory text.

            Database Schema Definition (Implicit Schema Name is required where explicitly shown):

            1. Sales.SalesOrderHeader (Tracks high-level order totals and dates)
            - Columns: SalesOrderID (int, PK), OrderDate (datetime), CustomerID (int, FK), SalesPersonID (int, NULL), SubTotal (money), TaxAmt (money), Freight (money), TotalDue (money), Status (tinyint)

            2. Sales.SalesOrderDetail (Tracks row-level transactional items per order)
            - Columns: SalesOrderID (int, PK/FK), SalesOrderDetailID (int, PK), OrderQty (smallint), ProductID (int, FK), UnitPrice (money), UnitPriceDiscount (money), LineTotal (computed money)
            - Relationship: Join to Sales.SalesOrderHeader ON SalesOrderID

            3. Production.Product (Tracks catalog items and pricing metrics)
            - Columns: ProductID (int, PK), Name (nvarchar), ProductNumber (nvarchar), Color (nvarchar), SafetyStockLevel (smallint), StandardCost (money), ListPrice (money), Size (nvarchar), Weight (decimal), ProductSubcategoryID (int, NULL)
            - Relationship: Join to Sales.SalesOrderDetail ON ProductID

            4. Sales.Customer (Links retail or store accounts)
            - Columns: CustomerID (int, PK), PersonID (int, NULL/FK), StoreID (int, NULL), TerritoryID (int)

            5. Person.Person (Tracks explicit name profiles for customers and corporate employees)
            - Columns: BusinessEntityID (int, PK), PersonType (nchar), FirstName (nvarchar), MiddleName (nvarchar), LastName (nvarchar)
            - Relationship: Join to Sales.Customer ON Person.Person.BusinessEntityID = Sales.Customer.PersonID OR Join to HumanResources.Employee ON Person.Person.BusinessEntityID = HumanResources.Employee.BusinessEntityID

            6. HumanResources.Employee (Internal tracking metrics)
            - Columns: BusinessEntityID (int, PK), NationalIDNumber (nvarchar), LoginID (nvarchar), JobTitle (nvarchar), BirthDate (date), MaritalStatus (nchar), Gender (nchar), HireDate (date), SalariedFlag (bit)

            7. Production.ProductInventory (Warehouse and structural logistical mappings)
            - Columns: ProductID (int, PK/FK), LocationID (smallint, PK), Shelf (nvarchar), Bin (tinyint), Quantity (smallint)
            - Relationship: Join to Production.Product ON ProductID

            8. Purchasing.PurchaseOrderHeader (Vendor expenditures tracking metrics)
            - Columns: PurchaseOrderID (int, PK), Status (tinyint), EmployeeID (int), VendorID (int, FK), OrderDate (datetime), SubTotal (money), TaxAmt (money), Freight (money), TotalDue (money)

            9. Purchasing.Vendor (Supplier corporate mappings)
            - Columns: BusinessEntityID (int, PK), AccountNumber (nvarchar), Name (nvarchar), CreditRating (tinyint), PreferredVendorStatus (bit), ActiveFlag (bit)
            - Relationship: Join to Purchasing.PurchaseOrderHeader ON Purchasing.Vendor.BusinessEntityID = Purchasing.PurchaseOrderHeader.VendorID`;
            
            const bedrockPayload1 = {
                "prompt": `System: ${schemaPrompt}\nUser: ${userMessage}\nAssistant:`,
                "max_gen_len": 350,
                "temperature": 0.0 // Strict code generation
                //system: schemaPrompt,
                //messages: [{ role: "user", content: userMessage }]
            };

            const command1 = new InvokeModelCommand({
                //modelId: CLAUDE_MODEL_ID,
                modelId: LLAMA_MODEL_ID,
                contentType: "application/json",
                body: JSON.stringify(bedrockPayload1),
                
                // --- FIRST-LINE DEFENSE: AWS BEDROCK CLOUD SAFEGARDS ---
                guardrailIdentifier: process.env.GUARDRAIL_ID,
                guardrailVersion: process.env.GUARDRAIL_VERSION
            });

            const bedrockResponse1 = await bedrockClient.send(command1);
            const responseBody1 = JSON.parse(new TextDecoder().decode(bedrockResponse1.body));

            // Validate if AWS Guardrail detected an exploit pattern or unsafe content
            if (responseBody1.action === "INTERVENED") {
                console.warn("CLOUD SECURITY ALERT: AWS Bedrock Guardrail intervened.");
                return res.json({ reply: "My safety protocols blocked that input because it was flagged as a potential system exploitation attempt." });
            }
            
            // Claude returns text here, not 'generation'
            //let generatedSQL = responseBody1.content[0].text.trim(); 
            let generatedSQL = responseBody1.generatedSQL.replace(/```sql|```/gi, '').trim();
            console.log("Response from LLM:\n " + generatedSQL);

            // 2. Safely find 'SELECT' and slice the string from there down
            const selectIndex = generatedSQL.toUpperCase().indexOf('SELECT');
            if (selectIndex !== -1) {
                generatedSQL = generatedSQL.substring(selectIndex).trim();
            }

            console.log("\n--- ENTERPRISE AGENT PIPELINE ---");
            console.log("1. LLM Generated SQL:", generatedSQL);

            // --- SECOND-LINE DEFENSE: STRUCTURAL COMPLIANCE VERIFICATION (AST) ---
            const securityCheck = validateSQLSecurity(generatedSQL);
            if (!securityCheck.safe) {
                console.warn(`APPLICATION SECURITY BREACH ATTEMPT DETECTED: ${securityCheck.reason}`);
                return res.json({ reply: "Security protocol error: The generated database execution format violated structural read-only isolation parameters." });
            }

            // 3. Fix common hallucinations
            //generatedSQL = generatedSQL
            //    .replace(/SalessOrderHeader/gi, 'SalesOrderHeader')  
            //    .trim(); 

            // Safety check — remains active to protect the database!
            //if (!generatedSQL.toUpperCase().startsWith('SELECT')) {
            //    return res.json({ reply: "Sorry, I couldn't generate a valid query for that." });
            //}



            // --- TRIP 2: Execute SQL ---
            const dbResults = await executeSQL(generatedSQL);

            // Programmatic fail-safes for explicit missing database items

            if (!dbResults.success) {
                console.error("2. Relational Query Intercept Error:", dbResults.error);
                
                
                if (dbResults.number === 208) {
                    return res.json({ reply: "I attempted to fetch this data, but the query mapped a non-existent database object table name." });
                } else if (dbResults.number === 207) {
                    return res.json({ reply: "I successfully localized the structural target table, but a queried column element name failed structural validation." });
                }
                return res.json({ reply: "An internal engine pipeline disconnect interrupted database schema execution." });
            }

            console.log("2. DB Results Fetched:", dbResults.data);

            
            //if (dbResults.error) {
            //    return res.json({ reply: "I encountered an error querying the database. The SQL generation failed." });
            //}

            // --- TRIP 3: Conversational Summary (Claude Format) ---
           // const finalPrompt = `You are a helpful enterprise AI assistant. The user asked a question, and your backend fetched this raw data from the SQL database: ${JSON.stringify(dbResults)}. Answer the user's question naturally in a single short paragraph using this exact data. Do not mention the database or SQL.`;
            
            //const bedrockPayload3 = {
               /* anthropic_version: "bedrock-2023-05-31",
                max_tokens: 300,
                temperature: 0.5, 
                system: finalPrompt,
                messages: [{ role: "user", content: userMessage }]*/

               /* "prompt": `System: ${schemaPrompt}\nUser: ${userMessage}\nAssistant:`,
                "max_gen_len": 300,
                "temperature": 0.0*/
           // };
           const finalPrompt = `You are a helpful data analyst assistant. The user asked an analytical question and your database engine fetched this explicit raw structured dataset: ${JSON.stringify(dbResults.data)}. Construct a single natural language sentence summarizing these findings to answer the query directly. Never reference raw code structures, column array items, or SQL keywords.`;
            const llamaPayload3 = {
            "prompt": `System: ${finalPrompt}\nUser: ${userMessage}\nAssistant:`,
            "max_gen_len": 300,
            "temperature": 0.5 // Higher temperature for more natural language
            };

            const command3 = new InvokeModelCommand({
            modelId: LLAMA_MODEL_ID, 
            contentType: "application/json",
            body: JSON.stringify(llamaPayload3)
            });

           /* const command3 = new InvokeModelCommand({
                //modelId: CLAUDE_MODEL_ID,
                modelId: LLAMA_MODEL_ID, 
                contentType: "application/json",
                body: JSON.stringify(bedrockPayload3)
            });*/

            const bedrockResponse3 = await bedrockClient.send(command3);
            const finalData = JSON.parse(new TextDecoder().decode(bedrockResponse3.body));
           
            console.log("3. Conversational Result Delivered to Browser Interface.\n---------------------------------\n");
            return res.json({ reply: finalData.generation.trim() });
           
            //console.log("Final Data Received from Llama:", finalData);
            //console.log("3. Final Agent Reply Generated.\n---------------------------------\n");
            
            //return res.json({ reply: finalData.content[0].text.trim() });
            //return res.json({ reply: finalData.generation.trim() });

        } 
        
        // 2. STANDARD CONVERSATION FALLBACK (Claude Format)
        else {
            console.log("Standard Non-Database Out-of-Bounds Chat Request...");
            
            const standardPayload = {
              /*anthropic_version: "bedrock-2023-05-31",
                max_tokens: 300,
                temperature: 0.7,
                system: "You are a helpful AI assistant.",
                messages: [{ role: "user", content: userMessage }]*/
                "prompt": `System: You are an enterprise helpful AI data assistant for the AdventureWorks corporation. Provide helpful information relative to business concepts or tell the user you specialize in structured database Lookups.\nUser: ${userMessage}\nAssistant:`,
                "max_gen_len": 300,
                "temperature": 0.0
            };
            
            const standardCommand = new InvokeModelCommand({
                //modelId: CLAUDE_MODEL_ID, 
                modelId: LLAMA_MODEL_ID,
                contentType: "application/json",
                body: JSON.stringify(standardPayload),
                guardrailIdentifier: process.env.GUARDRAIL_ID,
                guardrailVersion: process.env.GUARDRAIL_VERSION
            });

            const standardResponse = await bedrockClient.send(standardCommand);
            const data = JSON.parse(new TextDecoder().decode(standardResponse.body));

            if (data.action === "INTERVENED") {
                return res.json({ reply: "Content blocked due to cloud system security settings." });
            }
            
            res.json({ reply: data.generation.trim() });//reply: data.content[0].text.trim() });
        }

    } catch (error) {
        if (error.name === 'AccessDeniedException') {
            console.error("CRITICAL NETWORK BOUNDARY WARNING: AWS IAM key authorization revoked or dropped by edge access controls.");
            return res.status(403).json({ reply: 'Request blocked due to cloud network layer policy enforcement.' });
        }
        console.error("Agent Pipeline Crash:", error);
        res.status(500).json({ error: 'Failed to complete the agent pipeline.' });
    }
});

// Fallback route: serve index.html for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'rag.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Chat Server running on http://localhost:${PORT}`);
});
    /*try {
        // 1. SQL INTENT DETECTION: If user asks about sales or money...
        if (userMessage.toLowerCase().match(/(sales|order|revenue|total|due)/)) {
            
            // TRIP 1: Ask Qwen to translate English into a SQL query
            const schemaPrompt = `System: You are an expert SQL translator. Output ONLY a valid SQL SELECT statement. No explanations. 
            Database Schema: Table is 'Sales.SalesOrderHeader'. Columns are 'SalesOrderID', 'OrderDate', 'TotalDue', 'Status'.
            User: ${userMessage}
            Response:`;

            const sqlResponse = await fetch(`http://${jetsonIP}:11434/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: modelName, 
                    prompt: schemaPrompt, 
                    stream: false,
                    options: {
                        temperature: 0.0 // <--- FORCES STRICT CODE GENERATION
                    }
                }) 
            });
            
            const sqlData = await sqlResponse.json();
            let generatedSQL = sqlData.response
            console.log("Response from LLM "+generatedSQL);

                //.replace(/```sql|```/g, '')  // strip markdown fences
                generatedSQL
                .replace(/^[^S]*(SELECT)/i, 'SELECT')  // strip anything before SELECT
                .replace(/SalessOrderHeader/gi, 'SalesOrderHeader')  // fix common hallucination
                .trim(); 

// Safety check — never execute if it doesn't start with SELECT
            if (!generatedSQL.toUpperCase().startsWith('SELECT')) {
            return res.json({ reply: "Sorry, I couldn't generate a valid query for that." });
            }

console.log("1. Cleaned SQL:", generatedSQL);
            
            console.log("\n--- ENTERPRISE AGENT PIPELINE ---");
            console.log("1. LLM Generated SQL:", generatedSQL);

            // TRIP 2: Execute the query against your local Mac database
            const dbResults = await executeSQL(generatedSQL);
            console.log("2. DB Results Fetched:", dbResults);
            
            if (dbResults.error) {
                return res.json({ reply: "I encountered an error querying the database. The SQL generation failed." });
            }

            // TRIP 3: Feed the raw data back to Qwen to generate a human-readable sentence
            const finalPrompt = `System: You are a helpful enterprise AI assistant. The user asked a question, and your backend fetched this raw data from the SQL database: ${JSON.stringify(dbResults)}. Answer the user's question naturally in a single short paragraph using this exact data. Do not mention the database or SQL.
            User: ${userMessage}
            Response:`;

            const ollamaResponse = await fetch(`http://${jetsonIP}:11434/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(60000), // Force the connection to wait up to 60s
                body: JSON.stringify({ model: modelName, prompt: finalPrompt, stream: false})
            
                });
            const finalData = await finalResponse.json();
            console.log("3. Final Agent Reply Generated.\n---------------------------------\n");
            
            return res.json({ reply: finalData.response });
        } 
        
        // 2. STANDARD CONVERSATION FALLBACK
        else {
            console.log("Standard Chat Request...");
            const standardPrompt = `System: You are a helpful AI assistant.\n\nUser: ${userMessage}\n\nResponse:`;
            
            const ollamaResponse = await fetch(`http://${jetsonIP}:11434/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName, prompt: standardPrompt, stream: false })
            });

            const data = await ollamaResponse.json();
            res.json({ reply: data.response });
        }

    } catch (error) {
        console.error("Agent Pipeline Error:", error);
        res.status(500).json({ error: 'Failed to complete the agent pipeline.' });
    }
}); 

// Fallback route: serve index.html for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'rag.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Chat Server running on http://localhost:${PORT}`);
});*/