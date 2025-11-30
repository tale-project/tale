# Entity Finder Agent - Prompt Design

## 概述

Entity Finder Agent 使用了清晰的 **System Prompt** 和 **User Prompt** 分离设计，遵循以下原则：

- **System Prompt**：技术性指令，告诉 AI 如何工作（工具使用、参数、数据结构）
- **User Prompt**：业务意图，告诉 AI 用户想要什么（模糊的、高层次的）

## 设计原则

### System Prompt 的职责

System Prompt 应该包含所有**技术细节**，让 AI 知道：

1. **角色定义**：你是什么 agent，负责什么
2. **可用工具**：有哪些工具可以使用
3. **工具参数**：每个参数的含义和**必须使用的值**
4. **工具返回**：返回数据的结构和含义
5. **工作流程**：一步步应该做什么
6. **特殊协议**：如终止信号的格式
7. **示例**：完整的输入输出示例

**关键点**：System Prompt 应该强化到让 AI 无需猜测任何技术细节。

### User Prompt 的职责

User Prompt 应该是**业务导向**的，表达用户的意图：

- ✅ "Find a customer who needs status assessment"
- ✅ "Find an entity that needs processing"
- ✅ "Get me a customer to analyze"

**不应该包含**：

- ❌ 技术参数（entityType, workflowId, daysBack）
- ❌ 工具名称（find_unprocessed_entities）
- ❌ 数据结构（count, entities array）
- ❌ 实现细节（"use limit: 1"）

## 实现

### 配置结构

```typescript
export interface EntityFinderConfig {
  agentType: 'entity_finder';

  // 技术参数（用于构建 system prompt）
  entityType: 'customer' | 'product' | 'subscription';
  workflowId?: string;
  daysBack?: number;

  // 用户意图（业务导向）
  userPrompt?: string;

  // 可选的自定义 system prompt
  systemPrompt?: string;
}
```

### System Prompt 构建

System Prompt 是动态生成的，将配置参数注入到模板中：

```typescript
function buildSystemPrompt(config: {
  entityType: string;
  workflowId: string;
  daysBack: number;
}): string {
  return `You are an Entity Finder Agent...

  Tool Parameters (YOU MUST USE THESE EXACT VALUES):
  • entityType: "${config.entityType}"
  • workflowId: "${config.workflowId}"
  • daysBack: ${config.daysBack}
  • limit: 1 (ALWAYS use 1)
  
  ...`;
}
```

**优势**：

- AI 不需要从 user prompt 中提取参数
- 参数值是明确的、不可变的
- 减少了 AI 出错的可能性

### User Prompt 使用

```typescript
const {
  entityType,
  workflowId = context.workflowKey,
  daysBack = 3,
  userPrompt = DEFAULT_USER_PROMPT, // 默认值：简单模糊
  systemPrompt,
} = config;

// 如果用户没有提供 system prompt，使用动态生成的
const finalSystemPrompt =
  systemPrompt || buildSystemPrompt({ entityType, workflowId, daysBack });
```

## Workflow 配置示例

### 示例 1：使用默认 User Prompt

```typescript
{
  stepSlug: 'customer_finder',
  stepType: 'agent',
  config: {
    agent: {
      agentType: 'entity_finder',
      entityType: 'customer',
      // userPrompt 使用默认值："Find an entity that needs processing."
    },
  },
  nextSteps: {
    success: 'status_analyzer',
    terminate: 'finish',
  },
}
```

### 示例 2：自定义 User Prompt

```typescript
{
  stepSlug: 'customer_finder',
  stepType: 'agent',
  config: {
    agent: {
      agentType: 'entity_finder',
      entityType: 'customer',
      workflowId: 'assess-customer-status',
      daysBack: 7,
      userPrompt: 'Find a customer who needs their subscription status assessed',
    },
  },
  nextSteps: {
    success: 'status_analyzer',
    terminate: 'finish',
  },
}
```

### 示例 3：完全自定义（高级用法）

```typescript
{
  stepSlug: 'customer_finder',
  stepType: 'agent',
  config: {
    agent: {
      agentType: 'entity_finder',
      entityType: 'customer',
      userPrompt: 'Find a high-value customer for churn analysis',
      systemPrompt: `Custom system prompt with special instructions...`,
    },
  },
  nextSteps: {
    success: 'churn_analyzer',
    terminate: 'finish',
  },
}
```

## 对比：改进前 vs 改进后

### 改进前（❌ 混淆）

```typescript
// User prompt 包含了太多技术细节
const userPrompt = `Find ONE ${entityType} that needs processing.

Search parameters:
- Entity type: ${entityType}
- Workflow ID: ${workflowId}
- Days back: ${daysBack}
- Limit: 1

Use the find_unprocessed_entities tool to search...`;
```

**问题**：

- User prompt 变成了技术指令
- 用户无法自定义查询意图
- 混淆了"用户想要什么"和"如何实现"

### 改进后（✅ 清晰）

```typescript
// System Prompt：技术细节，强化指令
const systemPrompt = buildSystemPrompt({ entityType, workflowId, daysBack });
// 包含：工具参数、数据结构、工作流程、示例

// User Prompt：业务意图，简单模糊
const userPrompt = config.userPrompt || 'Find an entity that needs processing.';
```

**优势**：

- 职责分离清晰
- 用户可以自定义业务意图
- AI 有明确的技术指导
- 减少出错可能性

## 最佳实践

### 1. 默认情况下不需要自定义

大多数情况下，只需要配置技术参数：

```typescript
{
  agentType: 'entity_finder',
  entityType: 'customer',
  // 其他都用默认值
}
```

### 2. 自定义 User Prompt 表达业务意图

如果需要更具体的查询意图：

```typescript
{
  agentType: 'entity_finder',
  entityType: 'customer',
  userPrompt: 'Find a customer who recently became inactive',
}
```

### 3. 只在特殊情况下自定义 System Prompt

只有在需要完全不同的行为时才自定义 system prompt：

```typescript
{
  agentType: 'entity_finder',
  entityType: 'customer',
  systemPrompt: `You are a specialized customer finder...
    [Completely different instructions]`,
}
```

## 总结

这个设计遵循了 AI prompt engineering 的最佳实践：

1. **System Prompt = 技术指令**

   - 详细、明确、强化
   - 包含所有工具使用细节
   - 注入配置参数
   - 提供完整示例

2. **User Prompt = 业务意图**

   - 简单、模糊、高层次
   - 表达用户想要什么
   - 不关心实现细节
   - 可以在 workflow 中自定义

3. **Config = 技术参数**
   - 用于构建 system prompt
   - 明确的、类型安全的
   - 有合理的默认值

这样的设计让 AI 能够：

- 理解用户的业务意图（从 user prompt）
- 知道如何正确使用工具（从 system prompt）
- 使用正确的参数（从 config 注入到 system prompt）
- 返回正确的结果（从 system prompt 的示例）
