const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const Tesseract = require('tesseract.js');
const googleTTS = require('google-tts-api');

const BOT_TOKEN = '8624502955:AAHFHcQv2P67UKv8-4BRlnei_EC_-5Mfxfs';
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 300000 });

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

function splitTextIntoSafeChunks(text, chunkSize = 3000) {
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
        const chunks = splitTextIntoSafeChunks(cleanedText, 3000);
        const promises = chunks.map(async (chunk) => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(chunk)}`;
            const response = await axios.get(url, { timeout: 15000 });
            let translated = "";
            response.data[0].forEach(s => { if (s[0]) translated += s[0] + " "; });
            return translated;
        });
        return (await Promise.all(promises)).join(" ").trim();
    } catch (e) { return "Translation failed."; }
}

function getLanguageButtons() {
    const buttons = Object.keys(languages).map(lang => 
        [Markup.button.callback(languages[lang], `to_${lang}`)]
    );
    return Markup.inlineKeyboard(buttons);
}

bot.start((ctx) => ctx.reply("Welcome! Send text or file to translate."));

bot.on('text', async (ctx) => {
    userTexts[ctx.chat.id] = { content: ctx.message.text };
    ctx.reply("Select language:", getLanguageButtons());
});

bot.action(/^to_(.+)$/, async (ctx) => {
    const targetLang = ctx.match[1];
    const chatId = ctx.chat.id;
    const text = userTexts[chatId]?.content;

    if (!text) return ctx.reply("Session expired.");

    await ctx.editMessageText("Translating...");
    const translated = await translateText(text, targetLang);
    
    // Translation erguu
    await ctx.reply(`📝 **Translation:**\n\n${translated}`);
    
    // Speech button dabaluu
    await ctx.reply("Would you like to hear this?", Markup.inlineKeyboard([
        Markup.button.callback('🎧 Listen (Speech)', `speech_${targetLang}`)
    ]));
    
    userTexts[chatId].translated = translated; // Audio-tiif taa'a
});

bot.action(/^speech_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    const text = userTexts[ctx.chat.id]?.translated;
    if (!text) return ctx.answerCbQuery("Text not found.");

    try {
        const url = googleTTS.getAudioUrl(text, { lang: lang, slow: false });
        await ctx.replyWithAudio({ url: url });
    } catch (e) {
        ctx.reply("Error generating audio.");
    }
});

bot.launch();