
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { MessageSender, ChatMessage } from './types';
import { UploadIcon, SendIcon, BotIcon, UserIcon, PdfIcon } from './components/icons';

// Declare pdfjsLib globally as it's loaded from a CDN script
declare const pdfjsLib: any;

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Helper Components ---

const LoadingSpinner = () => (
    <div role="status" className="w-6 h-6">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid" width="100%" height="100%" style={{ background: 'none' }}>
            <circle cx="50" cy="50" r="40" stroke="#0ff" strokeWidth="8" fill="none" strokeDasharray="164.93361431346415 56.97787143782138">
                <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"></animateTransform>
            </circle>
        </svg>
        <span className="sr-only">Cargando...</span>
    </div>
);

interface MessageProps {
  message: ChatMessage;
}
const Message: React.FC<MessageProps> = ({ message }) => {
  const isBot = message.sender === MessageSender.BOT;
  return (
    <div className={`flex items-start gap-4 my-4 animate-fade-in ${isBot ? '' : 'flex-row-reverse'}`}>
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-lg ${isBot ? 'bg-secondary' : 'bg-primary/80'}`}>
        {isBot ? <BotIcon className="w-6 h-6 text-white" /> : <UserIcon className="w-6 h-6 text-dark" />}
      </div>
      <div className={`p-4 rounded-lg max-w-2xl bg-light/50 backdrop-blur-sm border border-light shadow-md`}>
        <p className="text-text-primary whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
};


// --- Main App Component ---

export default function App() {
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [userInput, setUserInput] = useState('');
  const [isBotReplying, setIsBotReplying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const resetState = () => {
    setPdfName(null);
    setIsProcessing(false);
    setMessages([]);
    setError(null);
    setChat(null);
    setUserInput('');
    setIsBotReplying(false);
  };

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Por favor, selecciona un archivo PDF válido.');
      return;
    }

    resetState();
    setIsProcessing(true);
    setError(null);
    setPdfName(file.name);

    try {
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        if (!event.target?.result) {
            setError('No se pudo leer el archivo.');
            setIsProcessing(false);
            return;
        }

        const typedArray = new Uint8Array(event.target.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n\n';
        }
        
        const initialBotMessage = "Documento analizado. Ya puedes hacer preguntas sobre su contenido.";
        
        const chatSession = ai.chats.create({
            model: 'gemini-2.5-flash',
            history: [
                {
                    role: 'user',
                    parts: [{ text: `Basándote EXCLUSIVAMENTE en el siguiente texto, responde a las preguntas del usuario. No uses conocimiento externo. El texto es:\n\n---\n\n${fullText}`}]
                },
                {
                    role: 'model',
                    parts: [{ text: initialBotMessage }]
                }
            ]
        });

        setChat(chatSession);
        setMessages([{ sender: MessageSender.BOT, text: initialBotMessage }]);
        setIsProcessing(false);

      };
      fileReader.readAsArrayBuffer(file);
    } catch (e) {
      console.error(e);
      setError('Ocurrió un error al procesar el PDF. Inténtalo de nuevo.');
      setIsProcessing(false);
    }
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || !chat || isBotReplying) return;

    const userMessage: ChatMessage = { sender: MessageSender.USER, text: userInput };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsBotReplying(true);

    try {
        const stream = await chat.sendMessageStream({ message: userInput });
        
        let botReply = '';
        setMessages(prev => [...prev, { sender: MessageSender.BOT, text: '' }]);

        for await (const chunk of stream) {
            botReply += chunk.text;
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1].text = botReply;
                return newMessages;
            });
        }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { sender: MessageSender.BOT, text: "Lo siento, un error de comunicación me impidió responder." }]);
    } finally {
      setIsBotReplying(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-dark text-text-primary font-sans">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])}
        className="hidden"
        accept=".pdf"
      />
      
      {/* Sidebar */}
      <aside className="w-1/3 max-w-sm flex flex-col bg-light/30 backdrop-blur-sm p-6 border-r border-light">
        <div className="flex items-center gap-3 mb-8">
            <div className="w-3 h-8 bg-primary rounded-full"></div>
            <h1 className="text-2xl font-bold text-white">PDF-Analyzer</h1>
        </div>
        
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-3 bg-secondary hover:bg-primary disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 shadow-lg hover:shadow-primary/40"
        >
          {isProcessing ? <LoadingSpinner /> : <UploadIcon className="w-6 h-6" />}
          <span>{isProcessing ? 'Procesando...' : (pdfName ? 'Cargar otro PDF' : 'Cargar PDF')}</span>
        </button>

        {error && <p className="text-red-400 mt-4 text-center animate-fade-in">{error}</p>}

        {pdfName && !isProcessing && (
          <div className="mt-8 p-4 bg-light/50 rounded-lg animate-fade-in border border-light">
              <h3 className="font-bold text-lg mb-3 text-white">Documento Activo</h3>
              <div className="flex items-center gap-3 text-text-secondary">
                <PdfIcon className="w-8 h-8 text-secondary flex-shrink-0" />
                <span className="truncate font-medium text-text-primary">{pdfName}</span>
              </div>
          </div>
        )}
        
        <div className="mt-auto text-center text-sm text-text-secondary">
            <p>Impulsado por Gemini & React</p>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col bg-dark/80">
        <div ref={chatContainerRef} className="flex-1 p-6 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-text-secondary animate-fade-in">
              <div className="relative mb-6">
                <UploadIcon className="w-32 h-32 text-primary opacity-20"/>
                <div className="absolute inset-0 flex items-center justify-center animate-pulse-glow">
                   <UploadIcon className="w-32 h-32 text-primary"/>
                </div>
              </div>
              <h2 className="text-2xl font-semibold text-white">Comienza subiendo un documento</h2>
              <p className="max-w-md mt-2">Sube un PDF para activar la interfaz de análisis y chat.</p>
            </div>
          ) : (
            messages.map((msg, index) => <Message key={index} message={msg} />)
          )}
           {isBotReplying && messages[messages.length-1]?.sender === MessageSender.USER && (
               <div className="flex items-start gap-4 my-4 animate-fade-in">
                 <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-secondary">
                   <BotIcon className="w-6 h-6 text-white" />
                 </div>
                 <div className="p-4 rounded-lg bg-light/50 backdrop-blur-sm">
                    <div className="flex items-center justify-center gap-2 h-6">
                        <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce"></div>
                    </div>
                 </div>
               </div>
            )}
        </div>
        <div className="p-6 border-t border-light">
          <form onSubmit={handleSendMessage} className="flex items-center gap-4 bg-light/50 p-2 rounded-lg border border-transparent focus-within:border-primary transition-all duration-300">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={pdfName ? 'Escribe tu pregunta...' : 'Sube un documento para empezar'}
              disabled={!chat || isBotReplying || isProcessing}
              className="flex-1 bg-transparent focus:ring-0 border-none p-2 text-text-primary placeholder-text-secondary"
            />
            <button
              type="submit"
              disabled={!chat || isBotReplying || isProcessing || !userInput.trim()}
              className="bg-secondary hover:bg-primary disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold p-3 rounded-full transition-all duration-300 shadow-lg hover:shadow-primary/40"
              aria-label="Enviar mensaje"
            >
              <SendIcon className="w-6 h-6" />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
