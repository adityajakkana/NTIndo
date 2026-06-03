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
            const schemaPrompt = `You are an expert SQL translator. Output ONLY a valid SQL SELECT statement. No explanations. 
            Database Schema: Table is 'Sales.SalesOrderHeader'. Columns are 'SalesOrderID', 'OrderDate', 'TotalDue', 'Status'.`;
            
            const bedrockPayload1 = {
                "prompt": `System: ${schemaPrompt}\nUser: ${userMessage}\nAssistant:`,
                "max_gen_len": 300,
                "temperature": 0.0 // Strict code generation
                //system: schemaPrompt,
                //messages: [{ role: "user", content: userMessage }]
            };

            const command1 = new InvokeModelCommand({
                //modelId: CLAUDE_MODEL_ID,
                modelId: LLAMA_MODEL_ID,
                contentType: "application/json",
                body: JSON.stringify(bedrockPayload1)
            });

            const bedrockResponse1 = await bedrockClient.send(command1);
            const responseBody1 = JSON.parse(new TextDecoder().decode(bedrockResponse1.body));

            // Claude returns text here, not 'generation'
            //let generatedSQL = responseBody1.content[0].text.trim(); 
            let generatedSQL = responseBody1.generation.trim();
            console.log("Response from LLM: " + generatedSQL);

            // 1. First, strip any markdown backtick fences completely
            generatedSQL = generatedSQL.replace(/```sql|```/gi, '').trim();

            // 2. Safely find 'SELECT' and slice the string from there down
            const selectIndex = generatedSQL.toUpperCase().indexOf('SELECT');
            if (selectIndex !== -1) {
                generatedSQL = generatedSQL.substring(selectIndex).trim();
            }

            // 3. Fix common hallucinations
            generatedSQL = generatedSQL
                .replace(/SalessOrderHeader/gi, 'SalesOrderHeader')  
                .trim(); 

            // Safety check — remains active to protect the database!
            if (!generatedSQL.toUpperCase().startsWith('SELECT')) {
                return res.json({ reply: "Sorry, I couldn't generate a valid query for that." });
            }

            console.log("\n--- ENTERPRISE AGENT PIPELINE ---");
            console.log("1. LLM Generated SQL:", generatedSQL);

            // --- TRIP 2: Execute SQL ---
            const dbResults = await executeSQL(generatedSQL);
            console.log("2. DB Results Fetched:", dbResults);
            
            if (dbResults.error) {
                return res.json({ reply: "I encountered an error querying the database. The SQL generation failed." });
            }

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
           const finalPrompt = `You are a helpful assistant. The user asked a question and your backend fetched this data: ${JSON.stringify(dbResults)}. Answer the user naturally. Do NOT output SQL. Do NOT repeat the query. Just give the answer.`;

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
            console.log("Final Data Received from Llama:", finalData);
            console.log("3. Final Agent Reply Generated.\n---------------------------------\n");
            
            //return res.json({ reply: finalData.content[0].text.trim() });
            return res.json({ reply: finalData.generation.trim() });

        } 
        
        // 2. STANDARD CONVERSATION FALLBACK (Claude Format)
        else {
            console.log("Standard Chat Request...");
            
            const standardPayload = {
              /*anthropic_version: "bedrock-2023-05-31",
                max_tokens: 300,
                temperature: 0.7,
                system: "You are a helpful AI assistant.",
                messages: [{ role: "user", content: userMessage }]*/
                "prompt": `System: ${schemaPrompt}\nUser: ${userMessage}\nAssistant:`,
                "max_gen_len": 300,
                "temperature": 0.0
            };
            
            const standardCommand = new InvokeModelCommand({
                //modelId: CLAUDE_MODEL_ID, 
                modelId: LLAMA_MODEL_ID,
                contentType: "application/json",
                body: JSON.stringify(standardPayload)
            });

            const standardResponse = await bedrockClient.send(standardCommand);
            const data = JSON.parse(new TextDecoder().decode(standardResponse.body));
            
            res.json({ reply: data.generation.trim() });//reply: data.content[0].text.trim() });
        }

    } catch (error) {
        console.error("Agent Pipeline Error:", error);
        res.status(500).json({ error: 'Failed to complete the agent pipeline.' });
    }
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
}); */

// Fallback route: serve index.html for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'rag.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Chat Server running on http://localhost:${PORT}`);
});