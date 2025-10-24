import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PDFExtract } from 'pdf.js-extract';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';



app.use(cors({
  origin: [
    "https://your-vercel-app.vercel.app",
    "https://scanme.vercel.app", // add your live domain if any
    "http://localhost:5173"     // dev only
  ]
}));


dotenv.config();

const app = express();
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 }
});
const pdfExtract = new PDFExtract();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Helper function to extract JSON from text
function extractJSON(text) {
  // Remove markdown code blocks
  text = text.replace(/``````\n?/g, '');
  
  // Find first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    text = text.substring(firstBrace, lastBrace + 1);
  }
  
  return text.trim();
}

app.post('/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('✅ Server on http://localhost:3001');
    console.log('📄 Processing:', req.file.originalname);

    let resumeText = '';

    if (req.file.mimetype === 'application/pdf') {
      if (!fs.existsSync('temp')) {
        fs.mkdirSync('temp');
      }
      
      const tempPath = path.join('temp', Date.now() + '.pdf');
      fs.writeFileSync(tempPath, req.file.buffer);
      
      try {
        const data = await pdfExtract.extract(tempPath, {});
        resumeText = data.pages.map(p => p.content.map(c => c.str).join(' ')).join('\n');
        console.log('✅ Text extracted');
      } finally {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
      
    } else if (req.file.mimetype === 'text/plain') {
      resumeText = req.file.buffer.toString('utf-8');
      console.log('✅ Text extracted');
    } else {
      return res.status(400).json({ error: 'Only PDF and TXT files supported' });
    }

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract text from file' });
    }

    console.log('🤖 Sending to Gemini AI...');

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `You are an expert ATS resume analyzer. Read the resume below carefully and provide a detailed analysis.

RESUME CONTENT:
${resumeText.substring(0, 4500)}

IMPORTANT: Analyze the ACTUAL content above. Do NOT use placeholder scores.

Your task:
1. Read the resume content carefully
2. Evaluate each category based on what you see
3. Calculate realistic scores (0-100) for:
   - ATS Compatibility: Check if resume uses standard sections, clear formatting, no tables/images
   - Work Experience: Evaluate quality of job descriptions, achievements, relevance
   - Content: Assess overall information quality, clarity, completeness
   - Formatting: Check professional appearance, readability, consistency
   - Skills: Count and evaluate technical/professional skills listed
   - Keywords: Identify industry-relevant keywords present

4. Calculate overall score as average of category scores

Return JSON in this format (REPLACE ALL VALUES with your analysis):
{
  "overallScore": culatelate from categories>,
  "categoryScores": {
    "atsCompatibility": <0-100 based on format analysis>,
    "workExperience": <0-100 based on experience quality>,
    "content": <0-100 based on content quality>,
    "formatting": <0-100 based on formatting>,
    "skills": <0-100 based on skills count/relevance>,
    "keywords": <0-100 based on keyword density>
  },
  "strengths": [
    "<identify actual strength from resume>",
    "<identify actual strength from resume>",
    "<identify actual strength from resume>"
  ],
  "improvements": [
    "<identify actual gap or weakness>",
    "<identify actual gap or weakness>",
    "<identify actual gap or weakness>"
  ],
  "suggestions": [
    "<specific actionable suggestion>",
    "<specific actionable suggestion>",
    "<specific actionable suggestion>"
  ],
  "feedback": "<write 3-4 sentences analyzing THIS SPECIFIC resume>"
}

DO NOT use example numbers. Analyze the actual resume content and provide real scores.`;


    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    console.log('✅ Gemini response received');
    console.log('📝 Raw response:', text.substring(0, 200));
    
    // Clean and extract JSON
    text = extractJSON(text);
    console.log('🔍 Cleaned JSON:', text.substring(0, 200));
    
    try {
      const analysis = JSON.parse(text);
      console.log('✅ Analysis complete - Score:', analysis.score);
      res.json(analysis);
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError.message);
      console.error('📄 Text that failed:', text);
      
      // Return default response if parsing fails
      res.json({
        score: 75,
        strengths: [
          "Resume uploaded successfully",
          "Content extracted from document",
          "Ready for detailed analysis"
        ],
        improvements: [
          "Add more quantifiable achievements",
          "Include relevant keywords for ATS",
          "Improve formatting for better readability"
        ],
        summary: "Resume analyzed. Consider the suggestions above for improvements."
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ 
      error: 'Analysis failed',
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
