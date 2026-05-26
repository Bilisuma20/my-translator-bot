const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const BOT_TOKEN = '8624502955:AAEFg7RM8Nrz_--TU1q9gBtmAbX_v-4CuQc';
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 120000
});

// Afaanota duraan turan osoo hin tuqin kanneen dabalataa baay'ee itti dabamaniiru
const languages = {
    // Kanneen duraan turan
    'af': 'Afrikaans', 'am': 'Amharic', 'ar': 'Arabic', 'en': 'English', 
    'fr': 'French', 'de': 'German', 'hi': 'Hindi', 'it': 'Italian', 
    'ja': 'Japanese', 'ko': 'Korean', 'om': 'Oromo', 'ru': 'Russian', 
    'es': 'Spanish', 'sw': 'Swahili', 'tr': 'Turkish',
    
    // Kanneen haaraa itti dabalaman (Afaanota beekamoo fi naannoo keenyaa)
    'so': 'Somali', 'ti': 'Tigrinya', 'zh': 'Chinese', 'pt': 'Portuguese',
    'nl': 'Dutch', 'sv': 'Swedish', 'no': 'Norwegian', 'fi': 'Finnish',
    'da': 'Danish', 'pl': 'Polish', 'uk': 'Ukrainian', 'id': 'Indonesian',
    'ms': 'Malay', 'vi': 'Vietnamese', 'th': 'Thai', 'fa': 'Persian',
    'he': 'Hebrew', 'ur': 'Urdu', 'bn': 'Bengali', 'pa': 'Punjabi',
    'te': 'Telugu', 'ta': 'Tamil', 'eo': 'Esperanto', 'la': 'Latin'
};

// Kuusaa memory yeroo gabaabaaf eegu
let userTexts = {};

function splitTextIntoSafeChunks(text, chunkSize = 1000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.substring(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks;
}

async function translateText(text, toLang) {
    try {
        const cleanedText = text.replace(/[\r\n]+/g, ' ').trim();
        const chunks = splitTextIntoSafeChunks(cleanedText, 1000);
        let finalTranslatedText = "";

        for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(chunk)}`;
            const response = await axios.get(url, { timeout: 10000 });
            
            if (response.data && response.data[0]) {
                response.data[0].forEach(sentence => {
                    if (sentence[0]) finalTranslatedText += sentence[0] + " ";
                });
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        return finalTranslatedText.trim() || "No translation found.";
    } catch (error) {
        return "Translation failed. Please try again.";
    }
}

// Button afaanotaa sarara tokko irratti sadi sadiin (3) akka ba'u gochuuf
function getLanguageButtons() {
    const buttons = [];
    const langKeys = Object.keys(languages);
    for (let i = 0; i < langKeys.length; i += 3) {
        const row = [];
        if (langKeys[i]) row.push(Markup.button.callback(languages[langKeys[i]], `to_${langKeys[i]}`));
        if (langKeys[i+1]) row.push(Markup.button.callback(languages[langKeys[i+1]], `to_${langKeys[i+1]}`));
        if (langKeys[i+2]) row.push(Markup.button.callback(languages[langKeys[i+2]], `to_${langKeys[i+2]}`));
        buttons.push(row);
    }
    return Markup.inlineKeyboard(buttons);
}

bot.start((ctx) => {
    ctx.reply("Welcome! Send me any text or upload a '.txt' or '.docx' file, then choose a language.");
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    userTexts[chatId] = {
        type: 'text',
        content: ctx.message.text
    };
    await ctx.reply("Select target language:", getLanguageButtons());
});

bot.on('document', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const doc = ctx.message.document;
        const fileName = doc.file_name.toLowerCase();

        await ctx.reply("Reading file... ⏳");
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        let fileContent = "";
        let fileType = "";

        if (doc.mime_type === 'text/plain' || fileName.endsWith('.txt')) {
            const fileResponse = await axios.get(fileLink.href);
            fileContent = fileResponse.data.toString();
            fileType = 'txt';
        } else if (fileName.endsWith('.docx')) {
            const fileResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(fileResponse.data);
            const result = await mammoth.extractRawText({ buffer: buffer });
            fileContent = result.value;
            fileType = 'docx';
        } else {
            return ctx.reply("Please upload '.txt' or '.docx' files only.");
        }

        if (!fileContent.trim()) return ctx.reply("File is empty!");

        userTexts[chatId] = {
            type: fileType,
            content: fileContent
        };
        await ctx.reply(`File received! Select language:`, getLanguageButtons());
    } catch (e) {
        ctx.reply("Error reading file.");
    }
});

bot.action(/^to_(.+)$/, async (ctx) => {
    try {
        const targetLang = ctx.match[1];
        const chatId = ctx.chat.id;
        const session = userTexts[chatId];

        if (!session || !session.content) {
            return ctx.reply("Session expired. Please send the text or file again.");
        }

        await ctx.answerCbQuery("Translating...");
        await ctx.editMessageText("Translating... ⏳");

        const translatedResult = await translateText(session.content, targetLang);
        
        if (session.type === 'docx') {
            await ctx.reply("Generating .docx file... 📄");
            
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: translatedResult,
                                    size: 24,
                                }),
                            ],
                        }),
                    ],
                }],
            });

            const buffer = await Packer.toBuffer(doc);
            
            await ctx.replyWithDocument({
                source: buffer,
                filename: `Translated_${languages[targetLang]}.docx`
            });
        } else {
            const responseChunks = splitTextIntoSafeChunks(translatedResult, 3500);
            for (const chunk of responseChunks) {
                await ctx.reply(`📝 **Translation (${languages[targetLang]}):**\n\n${chunk}`);
            }
        }
        
        delete userTexts[chatId];

    } catch (e) {
        console.error(e.message);
        ctx.reply("An error occurred during translation or file creation.");
    }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!\n');
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    bot.launch({ allowedUpdates: ['message', 'callback_query'], dropPendingUpdates: true })
       .then(() => console.log("Bot launched!"))
       .catch((err) => console.error(err.message));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));