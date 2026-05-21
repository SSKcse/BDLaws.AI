import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { question } = req.body;

        // 1. Vectorize Question
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const embRes = await embeddingModel.embedContent(question);
        const query_embedding = embRes.embedding.values;

        // 2. Search Supabase DB
        const { data: documents, error } = await supabase.rpc('match_documents', {
            query_embedding: query_embedding,
            match_threshold: 0.5,
            match_count: 3
        });

        let context = "ডেটাবেসে এই বিষয়ের কোনো সুনির্দিষ্ট তথ্য পাওয়া যায়নি।";
        let reference = "General AI Knowledge";

        if (documents && documents.length > 0) {
            context = documents.map(d => d.content).join('\n\n');
            reference = documents[0].metadata?.source || "Uploaded PDF Document";
        }

        const prompt = `তুমি 'AainKanun AI', বাংলাদেশের একটি ডিজিটাল আইনি সহকারী।
নিচের আইনি তথ্যের (Context) উপর ভিত্তি করে ব্যবহারকারীর প্রশ্নের উত্তর দাও। উত্তরটি অবশ্যই সহজ বাংলায় এবং সাধারণ মানুষের বোঝার উপযোগী হতে হবে।

Context: ${context}

User Question: ${question}`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 3. Setup Streaming
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        res.write(`data: ${JSON.stringify({ type: 'reference', text: reference })}\n\n`);

        const result = await model.generateContentStream(prompt);
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (error) {
        console.error("API Error:", error);
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: '\n\nদুঃখিত, একটি কারিগরি ত্রুটি হয়েছে।' })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
    }
}