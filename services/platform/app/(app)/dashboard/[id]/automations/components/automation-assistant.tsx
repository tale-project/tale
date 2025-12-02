'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Bot,
  Sparkles,
  Send,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';
import { useState, useRef, useEffect } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/hooks/use-convex-auth';
import { useThrottledScroll } from '@/hooks/use-throttled-scroll';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  automationContext?: string; // Optional automation context for first user message
}

function AutomationDetailsCollapse({ context }: { context: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-muted rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <span className="text-xs font-medium text-muted-foreground">
          Automation Details
        </span>
        {isOpen ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2 bg-background">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {context}
          </pre>
        </div>
      )}
    </div>
  );
}

function ThinkingAnimation() {
  const [currentStep, setCurrentStep] = useState(0);

  const thinkingSteps = [
    'Thinking',
    'Analyzing workflow',
    'Compiling an answer',
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (currentStep < thinkingSteps.length - 1) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, 2500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep, thinkingSteps.length]);

  return (
    <div className="flex justify-start">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.2,
          ease: 'easeInOut',
        }}
        className="text-xs text-muted-foreground flex items-center gap-2 px-3"
      >
        <motion.span
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.2,
            ease: 'easeInOut',
          }}
          className="inline-block"
        >
          {thinkingSteps[currentStep]}
        </motion.span>
        <div className="flex space-x-1">
          <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

interface AutomationAssistantProps {
  automationId?: Id<'wfDefinitions'>;
  organizationId: string;
  onClearChat?: () => void;
}

export function AutomationAssistant({
  automationId,
  organizationId,
  onClearChat,
}: AutomationAssistantProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  // Connect to workflow assistant agent
  const chatWithWorkflowAssistant = useAction(
    api.workflow_assistant_agent.chatWithWorkflowAssistant,
  );
  const createChatThread = useMutation(api.threads.createChatThread);
  const deleteChatThread = useMutation(api.threads.deleteChatThread);
  const updateWorkflowMetadata = useMutation(
    api.wf_definitions.updateWorkflowMetadata,
  );

  // Load workflow to get threadId from metadata (use public API)
  const workflow = useQuery(
    api.wf_definitions.getWorkflowPublic,
    automationId ? { wfDefinitionId: automationId } : 'skip',
  );

  // Load thread messages when threadId is available
  const threadMessages = useQuery(
    api.threads.getThreadMessages,
    threadId ? { threadId } : 'skip',
  );

  // Load threadId from workflow metadata when workflow is loaded
  useEffect(() => {
    if (workflow?.metadata?.threadId && !threadId) {
      setThreadId(workflow.metadata.threadId);
    }
  }, [workflow, threadId, automationId]);

  // Sync messages from thread - always use thread as source of truth when available
  useEffect(() => {
    if (threadMessages?.messages && threadMessages.messages.length > 0) {
      const threadMsgs: Message[] = threadMessages.messages.map((m) => ({
        id: m._id,
        role: m.role,
        content:
          m.role === 'user' ? stripWorkflowContext(m.content) : m.content,
        timestamp: new Date(m._creationTime),
      }));
      setMessages(threadMsgs);
    }
  }, [threadMessages]);

  // Scroll to bottom when new messages arrive using throttled scroll
  useEffect(() => {
    if (messages.length === 0) return;

    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [messages.length, throttledScrollToBottom]);

  // Cleanup throttled scroll on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !organizationId) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    try {
      // Ensure we have a real Agent thread for this automation chat
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const title =
          messageContent.length > 50
            ? `${messageContent.substring(0, 50)}...`
            : messageContent;

        currentThreadId = await createChatThread({
          organizationId: organizationId as string,
          title,
          chatType: 'workflow_assistant',
        });
        setThreadId(currentThreadId);
      }

      // Call the workflow assistant agent with a real Agent thread id
      // Messages will be automatically synced from threadMessages query
      await chatWithWorkflowAssistant({
        threadId: currentThreadId!,
        organizationId,
        workflowId: automationId,
        message: messageContent,
      });
    } catch (error) {
      console.error('Error calling workflow assistant:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          "I'm sorry, I encountered an error. Please try again or check the console for details.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = async () => {
    if (!user?._id) {
      console.error('User not authenticated');
      return;
    }

    try {
      // Delete the thread if it exists
      if (threadId) {
        await deleteChatThread({
          threadId: threadId,
        });
      }

      // Reset threadId in workflow metadata if automationId exists
      if (automationId && workflow?.metadata) {
        await updateWorkflowMetadata({
          wfDefinitionId: automationId,
          metadata: { ...workflow.metadata, threadId: null },
          updatedBy: user._id,
        });
      }

      // Reset local state
      setThreadId(null);
      setMessages([]);
      setInputValue('');

      // Call parent callback if provided
      onClearChat?.();
    } catch (error) {
      console.error('Error clearing chat:', error);
      // Still reset local state even if server updates fail
      setThreadId(null);
      setMessages([]);
      setInputValue('');
    }
  };

  return (
    <>
      {/* Header with clear button */}
      {messages.length > 0 && threadId && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClearChat}
          className="h-8 w-8 absolute top-3.5 right-2"
        >
          <Trash2 className="size-4" />
        </Button>
      )}

      {/* Chat messages */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-y-auto p-2 space-y-2.5"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-start h-full py-4">
            <div className="flex gap-2 items-start">
              <div className="p-1.5 rounded-lg bg-muted shrink-0 h-fit">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-muted text-foreground max-w-[85%]">
                <p className="text-xs">
                  {workflow?.status === 'draft'
                    ? "Hi! I'm your automation assistant. I can help you create and edit this automation. Just describe what you want to automate, and I'll build it for you!"
                    : "Hi! I'm your automation assistant. I can help you understand and discuss this automation. What would you like to know?"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-1',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div className="flex flex-col gap-2 max-w-[92.5%]">
                  {message.automationContext && (
                    <AutomationDetailsCollapse
                      context={message.automationContext}
                    />
                  )}
                  {message.content && (
                    <div
                      className={cn(
                        'rounded-lg px-3 py-2',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <div className="text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-headings:my-2 [&_li]:mb-1 [&_ul]:my-2 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-1 [&_ol]:mt-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:list-decimal-leading-zero [&_code]:bg-muted-foreground/10 [&_code]:text-[10px] [&_code]:text-muted-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:break-words [&_code]:whitespace-normal [&_code]:inline-block [&_code]:max-w-full [&_pre_code]:overflow-auto [&_pre_code]:block [&_pre_code]:whitespace-pre [&_pre_code]:break-normal [&_p]:mb-1 [&_p]:mt-1 [&_p]:break-words [&_h3]:mt-2">
                          <Bot className="size-4 text-muted-foreground mb-2" />
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-xs whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && <ThinkingAnimation />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat input */}
      <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2 sticky bottom-0 z-50">
        <div className="bg-background rounded-t-[0.875rem] relative p-1 border border-muted-foreground/50 border-b-0">
          <div className="transition-all duration-300 ease-in-out overflow-y-auto h-[3rem]">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="resize-none border-0 outline-none bg-transparent p-2 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm min-h-[2.5rem]"
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center justify-end py-2">
            <Button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              className="rounded-full"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
