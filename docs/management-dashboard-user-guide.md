# Management Dashboard User Guide

## Overview

This documentation provides operations staff with a comprehensive guide to understanding and using the management dashboard system's features and capabilities. The dashboard serves as a central hub for managing customer relationships, product recommendations, automated communications, and business insights.

## System Architecture

The management dashboard features a modern interface designed to streamline business operations through integrated modules:

- **Home Dashboard** - Central command center displaying key business metrics, customer lifecycle trends, and quick access to critical functions
- **Customer Management** - Comprehensive customer database with import tools, status tracking, and detailed customer profiles for managing your entire customer base
- **Product Management** - Product catalog management with recommendation engine configuration, inventory tracking, and cross-selling relationship setup
- **Conversations** - Unified communication hub that manages all customer interactions including automated product recommendations, churn prevention surveys, and customer service requests across multiple channels
- **Task Management** - Automated business process monitoring and manual task execution for streamlined operations
- **Settings Center** - System-wide configuration including branding, integrations, communication templates, and team management
- **AI Assistant** - Intelligent business advisor providing data insights, trend analysis, and operational recommendations

## Feature Modules

### 1. Home Dashboard

The Home Dashboard serves as your business command center, providing at-a-glance insights into customer health, business performance, and automated campaign management. This centralized view helps you make data-driven decisions and quickly identify areas requiring attention.

**Main Features:**

- **Customer Lifecycle Chart** - Visual representation of how customers move through different stages (Active → Potential → Churned), helping you identify trends in customer retention and acquisition patterns over time

- **Customer Metrics Overview** - Real-time display of critical business KPIs including total customer count, active customer percentage, churn rate, and growth metrics to monitor business health

- **Churn Survey Configuration** - Quick setup interface for automated retention campaigns, allowing you to configure when and how churn prevention surveys are sent to at-risk customers

- **Business Task Processing** - Monitor and trigger automated business processes such as recommendation generation, email campaigns, and data synchronization tasks

**Use Cases:**

- **Business Health Monitoring**: Get instant visibility into customer retention trends and overall business performance
- **Trend Analysis**: Track customer lifecycle changes to identify seasonal patterns or business impact events
- **Campaign Management**: Configure and monitor automated marketing and retention campaigns from a central location
- **Operational Oversight**: Keep track of automated processes and ensure business operations are running smoothly

### 2. Customer Management

**Core Features:**

#### 2.1 Customer List Management

- **Customer Information Display**: Name, email, status, source, locale, creation date
- **Customer Status Categories**:
  - `Active` - Active customers
  - `Potential` - Potential customers
  - `Churned` - Churned customers
- **Search and Filter**: Search by name/email, filter by status
- **Pagination**: Customizable page size (10/20/50 items)

#### 2.2 Customer Import Functionality

- **Manual Import**: Direct input of customer email lists
  - Format: `customer@example.com` or `customer@example.com,locale`
  - Supports batch import of multiple customers
- **File Import**: Supports Excel and CSV files
  - Required fields: email
  - Optional fields: locale (language setting)
  - Supported formats: .xlsx, .xls, .csv
  - Multi-language support: en, de, fr, zh, etc. and extended formats (en-US, de-DE, etc.)

#### 2.3 Customer Operations

- **View Subscriptions**: View customer product subscription details
- **Delete Customer**: Only manually imported customers can be deleted
- **Customer Details**: View complete customer profile information

**Operation Guide:**

1. Click "Import Churned" button to import churned customers
2. Select import method (manual input or file upload)
3. Input or upload customer data according to format requirements
4. System automatically validates and imports customer information

### 3. Product Management

**Main Features:**

#### 3.1 Product Information Management

- **Product Display**: Images, name, description, stock, creation date
- **Product Search**: Search by name or description
- **Product Details**: Expandable view for complete product information
- **External Links**: Direct navigation to product pages

#### 3.2 Product Recommendation Settings

- **Related Product Configuration**: Set recommendation relationships between products
- **Recommendation Metadata Management**: Configure recommendation algorithm parameters
- **Multi-language Support**: Multi-language translations for product names

#### 3.3 Product Data Management

- **Batch Import**: Import products from platforms like Shopify
- **Data Export**: Export product lists for analysis
- **Inventory Management**: Track product stock status
- **Product Types**: Distinguish between physical items and services

**Operation Guide:**

1. Use search box to quickly locate specific products
2. Click product name to expand detailed information
3. Use "Relationships" column to configure product recommendation associations
4. Access product pages through external link buttons

### 4. Conversations Management

The Conversations module serves as your central communication hub, managing all customer interactions across different channels and purposes. This system replaces traditional email management by providing a unified interface for automated marketing campaigns, customer service requests, and retention efforts.

**What is the Conversations System?**
The Conversations feature consolidates all customer communications into organized threads, whether they're automated product recommendations sent to active customers, churn prevention surveys for at-risk customers, or service requests. Each conversation represents a complete communication thread with a specific customer, allowing you to track the entire interaction history and manage follow-ups effectively.

**Core Features:**

#### 4.1 Conversation List Management

The conversation list provides a comprehensive view of all customer interactions with intelligent organization:

- **Conversation Status Workflow**:
  - `Pending` - New conversations awaiting staff review or customer response
  - `Resolved` - Completed conversations where the customer's needs have been addressed
  - `Spam` - Filtered unwanted or irrelevant messages
  - `Archived` - Conversations automatically archived after 30 days of inactivity to keep the active list manageable

#### 4.2 Conversation Categories and Organization

The system automatically categorizes conversations based on their purpose and business context:

- **Category Management**:

  - `Product Recommendation` - Automated recommendations sent to active customers based on their purchase history and preferences, designed to increase cross-selling and upselling opportunities
  - `Service Request` - Customer-initiated inquiries about products, orders, support issues, or general questions requiring staff attention
  - `Churn Survey` - Targeted retention campaigns sent to customers showing signs of disengagement, including feedback surveys and win-back offers

- **Priority Settings**: Conversations are automatically assigned priority levels (High, Medium, Low) based on customer value, urgency indicators, and business rules to help staff focus on the most important interactions first

- **Channel Management**: Supports multiple communication channels including Email, WhatsApp, and other messaging platforms, with plans for website chat integration

#### 4.3 Message Management and Workflow

Advanced message handling capabilities ensure efficient communication processing:

- **Message Status Tracking**:

  - `Draft` - Messages being composed
  - `Pending Approval` - Automated messages awaiting staff review before sending
  - `Approved` - Messages cleared for delivery
  - `Sent` - Successfully delivered messages
  - `Failed` - Messages that couldn't be delivered

- **Bulk Operations**: Streamline workflow with batch actions:

  - Bulk resolve multiple conversations simultaneously
  - Mass send approved messages to multiple customers
  - Batch update conversation status or priority
  - Export conversation data for analysis

- **Rich Media Support**: Handle various content types including images, videos, audio files, and documents to provide comprehensive customer support

**Operation Guide:**

1. **Filtering and Organization**: Use the filter system to view conversations by status (Pending, Resolved), category (Product Recommendation, Service Request, Churn Survey), priority level, or communication channel
2. **Conversation Details**: Click on any conversation to view the complete message thread, customer context, and interaction history
3. **Efficient Processing**: Utilize bulk operations to handle multiple similar conversations simultaneously, improving response times and operational efficiency
4. **Quick Search**: Use the search function to instantly locate specific conversations by customer name, email, keywords, or conversation content
5. **Approval Workflow**: Review and approve automated messages before they're sent to ensure quality and brand consistency

### 5. Task Management

**Features:**

- **Task Status Tracking**: Pending, Resolved
- **Task Search**: Search tasks by keywords
- **Task Details**: View task execution details and results
- **Automated Processing**: System automatically executes business tasks

**Usage Instructions:**

- Monitor automated task execution status
- View task processing results and error information
- Manually trigger specific business processes

### 6. Settings Center

#### 6.1 General Settings

- **Theme Settings**:
  - Light Mode - Bright mode
  - Dark Mode - Dark mode
  - System - Follow system settings

#### 6.2 Organization Settings

- **Organization Information Management**: Name, logo, etc.
- **Website Settings**: Configure business website URL
- **Member Management**: Manage team member permissions

#### 6.3 Channels Settings

- **Email Settings**: Configure email sending parameters
- **Website Integration**: Website chatbot (in development)
- **API Integration**: API interface configuration (in development)
- **Teams Integration**: Team collaboration tools (in development)

#### 6.4 Tone of Voice Settings

- **Template Management**:
  - Product recommendation templates
  - Churn survey templates
  - Potential customer recommendation templates
- **Tone Analysis**: Generate brand tone based on example emails
- **Multi-language Templates**: Support creating multi-language content

#### 6.5 Integrations Settings

- **Shopify Integration**: Connect Shopify store
- **Circuly Integration**: Connect Circuly platform
- **Third-party Services**: Other business system integrations

**Configuration Guide:**

1. Upload brand email examples in tone of voice settings
2. System automatically analyzes and generates brand tone description
3. Create and manage various message templates
4. Configure integration services to sync data

### 7. AI Assistant (Ask AI)

The AI Assistant is your intelligent business advisor, powered by advanced AI technology that understands your business data and can provide actionable insights, answer complex questions, and suggest optimization strategies. Think of it as having a data analyst and business consultant available 24/7.

**What Can the AI Assistant Do?**
The AI Assistant has access to your complete business data including customer information, product catalog, conversation history, and performance metrics. It can analyze patterns, identify trends, and provide recommendations based on your specific business context.

**Intelligent Features:**

- **Business Q&A**: Ask natural language questions about your business data and receive detailed, contextual answers. Examples: "Which products have the highest churn rate?" or "What's our customer acquisition trend this quarter?"

- **Conversation History**: Maintains a complete record of your AI interactions, allowing you to reference previous analyses and build upon earlier insights for deeper understanding

- **Intelligent Analysis**: Performs complex data analysis and pattern recognition to identify business opportunities, potential issues, and optimization areas you might not have considered

- **Operation Suggestions**: Provides AI-powered recommendations for improving business processes, customer engagement strategies, and operational efficiency based on your data patterns

**Usage Tips and Examples:**

- **Customer Analytics**: "Show me customer retention rates by product category" or "Which customers are most likely to churn next month?"
- **Business Performance**: "What's driving our recent sales increase?" or "Compare this quarter's performance to last quarter"
- **Marketing Optimization**: "Which product recommendations have the highest conversion rates?" or "What's the best time to send churn surveys?"
- **Operational Guidance**: "How can I improve our customer response times?" or "What automation opportunities exist in our workflow?"
- **Trend Analysis**: "What seasonal patterns do you see in our customer behavior?" or "How has our product mix changed over time?"

## Permission Management

The system supports role-based access control:

- **Owner** - Organization owner with full permissions
- **Admin** - Administrator who can manage business settings
- **Developer** - Developer with access to technical settings
- **Member** - Regular member with basic operation permissions

## Data Security

- **Row Level Security**: Ensures users can only access their own business data
- **Permission Verification**: All operations undergo strict permission checks
- **Data Encryption**: Sensitive information is stored encrypted
- **Audit Logs**: Records audit trails of important operations

## Frequently Asked Questions

**Q: How to import customer data?**
A: Go to customer management page, click "Import Churned" button, select manual input or file upload method.

**Q: How to set product recommendation relationships?**
A: In the product management page, click the "Relationships" column of the product row to configure.

**Q: How to configure email templates?**
A: Go to Settings > Tone of Voice, select the corresponding template type to edit.

**Q: What languages does the system support?**
A: Supports English, German, French, Chinese, and other languages. Check the support list when importing customers.

## Technical Support

For technical issues or feature consultation, please contact the technical support team. The system will be continuously updated and optimized, with usage guidance provided for new features upon release.
