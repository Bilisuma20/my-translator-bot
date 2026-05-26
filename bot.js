const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const Tesseract = require('tesseract.js');

// Gadi-lakkisaa (⚠️ Token kee nama biraatiin akka hin argamne of eeggadhurru)
const BOT_TOKEN = '8624502955:AAHFHcQv2P67UKv8-4BRlnei_EC_-5Mfxfs';
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 300000 // Timeout gara daqiiqaa 5tti ol guddifneerra akka bot-ni hin dhiifne
});

const languages = {
    'af': 'Afrikaans', 'am': 'Amharic', 'ar': 'Arabic', 'en': 'English', 
    'fr': 'French', 'de': 'German', 'hi': 'Hindi', 'it': 'Italian', 
    'ja': 'Japanese', 'ko': 'Korean', 'om': 'Oromo', 'ru': 'Russian', 
    'es': 'Spanish', 'sw': 'Swahili', 'tr': 'Turkish',
    'so': 'Somali', 'ti': 'Tigrinya', 'zh': 'Chinese', 'pt': 'Portuguese',
    'nl': 'Dutch', 'sv': 'Swedish', 'no': 'Norwegian', 'fi': 'Finnish',
    'da': 'Danish', 'pl': 'Polish', 'uk': 'Ukrainian', 'id': 'Indonesian',
    'ms': 'Malay', 'vi': 'Vietnamese', 'th': 'Thai', 'fa': 'Persian',
    'he': 'Hebrew', 'ur': 'Urdu', 'bn': 'Bengali', 'pa': 'Punjabi',
    'te': 'Telugu', 'ta': 'Tamil', 'eo': 'Esperanto', 'la': 'Latin'
};

let userTexts = {};

// Fuula 200 saffisaan hojjechuuf chunk size 3000 gooneerra
function splitTextIntoSafeChunks(text, chunkSize = 3000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.substring(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks;
}

// Chunks hunda yeroo tokkotti parallel erguuf kan jijjiurame
async function translateText(text, toLang) {
    try {
        const cleanedText = text.replace(/[\r\n]+/g, ' ').trim();
        const chunks = splitTextIntoSafeChunks(cleanedText, 3000);
        
        // Request hunda yeroo tokkotti uumna
        const promises = chunks.map(async (chunk) => {
            if (!chunk.trim()) return "";
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(chunk)}`;
            try {
                const response = await axios.get(url, { timeout: 15000 });
                let chunkTranslated = "";
                if (response.data && response.data[0]) {
                    response.data[0].forEach(sentence => {
                        if (sentence[0]) chunkTranslated += sentence[0] + " ";
                    });
                }
                return chunkTranslated;
            } catch (err) {
                // Yoo API bilisaa sun rate limit kenne, barruu calqabaa gadi lakkisa (akka hin badneef)
                return chunk; 
            }
        });

        // Hunda isaanii wal-bira qabnee sekondii muraasa keessatti eegna
        const translatedChunks = await Promise.all(promises);
        return translatedChunks.join(" ").trim() || "No translation found.";
    } catch (error) {
        return "Translation failed. Please try again.";
    }
}

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
    ctx.reply("Welcome! Send me text, upload a '.txt'/'.docx' file, or send an Image, then choose a language.");
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    userTexts[chatId] = {
        type: 'text',
        content: ctx.message.text
    };
    await ctx.reply("Select target language:", getLanguageButtons());
});

bot.on('photo', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        await ctx.reply("Reading text from image... 🔍⏳");
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const { data: { text } } = await Tesseract.recognize(fileLink.href, 'eng+ara+fra');

        if (!text || !text.trim()) {
            return ctx.reply("Could not detect any clear text in the image.");
        }

        userTexts[chatId] = { type: 'text', content: text };
        await ctx.reply(`Text detected! Select language:`, getLanguageButtons());
    } catch (e) {
        ctx.reply("Error processing image.");
    }
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

        userTexts[chatId] = { type: fileType, content: fileContent };
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
            return ctx.reply("Session expired. Please send the file again.");
        }

        await ctx.answerCbQuery("Translating...");
        await ctx.editMessageText("Translating your document, please wait... ⏳");

        // Asynchronous parallel translation
        const translatedResult = await translateText(session.content, targetLang);
        
        if (session.type === 'docx') {
            await ctx.reply("Generating .docx file... 📄");
            
            // Barruu guutuu fuula 200 san paragraph tokko keessatti akka hin kuusneef line-by-line addaan baasna
            const lines = translatedResult.split('. ');
            const paragraphs = lines.map(line => new Paragraph({
                children: [new TextRun({ text: line + ". ", size: 24 })]
            }));

            const doc = new Document({
                sections: [{
                    properties: {},
                    children: paragraphs,
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
        ctx.reply("An error occurred during translation.");
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