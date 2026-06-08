import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import 'dotenv/config';

// Setup for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const PORT = 8080;

app.use(express.json());
app.use(express.static(__dirname, { index: false }));

// Initialize AWS Bedrock
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION,
    token: { token: process.env.AWS_BEARER_TOKEN_BEDROCK }
});

// We are switching from InvokeModel to ConverseCommand, which handles tools perfectly.
//const MODEL_ID = "meta.llama3-70b-instruct-v1:0"; 
//const MODEL_ID = "meta.llama3-70b-instruct-v1:0"; 
// If Llama 3 throws a tool compatibility error in Bedrock, uncomment Claude below:
// const MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"; 
//const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
//const MODEL_ID = "amazon.nova-micro-v1:0";
//const MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
//const MODEL_ID ="global.anthropic.claude-3-haiku-20240307-v1:0"
//const MODEL_ID ="cohere.command-r-v1:0"
const MODEL_ID ="apac.anthropic.claude-haiku-4-5-20251001-v1:0"
// If Llama 3 throws a tool compatibility error in Bedrock, uncomment Claude below:
// const MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"; 

let mcpClient;

// --- INITIALIZE MCP CONNECTION ---
async function setupMCP() {
    // This transport automatically launches your new mcp-server.js file in the background
    const transport = new StdioClientTransport({
        command: "node",
        args: ["./mcp-server.js"] // Make sure this points to your new MCP file!
    });
    
    mcpClient = new Client({ name: "express-bedrock-agent", version: "1.0.0" });
    await mcpClient.connect(transport);
    console.log("Connected to local MCP Database Server!");
}
setupMCP();

// --- THE CHAT PIPELINE ---
app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;

    try {
        // 1. Ask the MCP Server what tools it has (e.g., query_database)
        const mcpTools = await mcpClient.listTools();
        
        // 2. Format those tools so Bedrock understands them
        const bedrockTools = mcpTools.tools.map(tool => ({
            toolSpec: {
                name: tool.name,
                description: tool.description,
                inputSchema: { json: tool.inputSchema }
            }
        }));

        // 3. Send the user's message AND the available tools to Bedrock
        const conversation = [{ role: "user", content: [{ text: userMessage }] }];
        
        const command = new ConverseCommand({
            modelId: MODEL_ID,
            messages: conversation,
            toolConfig: { tools: bedrockTools } 
        });

        console.log("Thinking...");
        const response = await bedrockClient.send(command);
        const outputMessage = response.output.message;

        // 4. AUTONOMOUS ROUTING: Did Bedrock decide to use the database?
        if (response.stopReason === "tool_use") {
            const toolRequest = outputMessage.content.find(c => c.toolUse).toolUse;
            console.log(`\nAgent decided to execute tool: ${toolRequest.name}`);

            // 5. Execute the tool dynamically via the MCP Server
            const toolResult = await mcpClient.callTool({
                name: toolRequest.name,
                arguments: toolRequest.input
            });

            console.log("Database results retrieved! Summarizing for user...");

            // 6. Send the raw data back to Bedrock to get a human-readable sentence
            conversation.push(outputMessage); 
            conversation.push({
                role: "user",
                content: [{
                    toolResult: {
                        toolUseId: toolRequest.toolUseId,
                        content: [{ json: toolResult }]
                    }
                }]
            });

            const finalCommand = new ConverseCommand({
                modelId: MODEL_ID,
                messages: conversation
            });

            const finalResponse = await bedrockClient.send(finalCommand);
            return res.json({ reply: finalResponse.output.message.content[0].text });
        } 
        
        // 7. STANDARD CHAT: Bedrock didn't need the database, it just answered normally.
        else {
            console.log("Standard Chat Responded.");
            return res.json({ reply: outputMessage.content[0].text });
        }

    } catch (error) {
        if (error.name === 'AccessDeniedException') {
            console.error("CRITICAL NETWORK WARNING: AWS IAM key dropped.");
            return res.status(403).json({ reply: 'Request blocked due to cloud network layer policy.' });
        }
        console.error("Agent Pipeline Crash:", error);
        res.status(500).json({ error: 'Failed to complete the agent pipeline.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'rag.html'));
});

app.listen(PORT, () => {
    console.log(`Chat Server running on http://localhost:${PORT}`);
});
