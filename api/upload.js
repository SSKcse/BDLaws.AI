import formidable from 'formidable';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export const config = {
    api: { bodyParser: false }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const form = formidable({ multiples: false });

    form.parse(req, async (err, fields, files) => {
        if (err) return res.status(500).json({ error: 'File parsing failed' });
        
        const file = files.file[0] || files.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        try {
            const dataBuffer = fs.readFileSync(file.filepath);
            const pdfData = await pdfParse(dataBuffer);
            const text = pdfData.text;

            const rawChunks = text.split('\n\n').filter(c => c.trim().length > 50);
            const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            
            let uploadedChunks = 0;

            for (let i = 0; i < rawChunks.length; i++) {
                const chunkText = rawChunks[i].trim();
                const embRes = await embeddingModel.embedContent(chunkText);
                
                await supabase.from('documents').insert({
                    content: chunkText,
                    metadata: { source: file.originalFilename || "Document", chunk_id: i },
                    embedding: embRes.embedding.values
                });
                
                uploadedChunks++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            res.status(200).json({ message: 'Success', chunks: uploadedChunks });

        } catch (error) {
            console.error("Upload Error:", error);
            res.status(500).json({ error: error.message });
        }
    });
}