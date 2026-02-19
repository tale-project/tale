/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts_helpers from "../accounts/helpers.js";
import type * as accounts_queries from "../accounts/queries.js";
import type * as accounts_types from "../accounts/types.js";
import type * as accounts_validators from "../accounts/validators.js";
import type * as agent_tools_create_json_output_tool from "../agent_tools/create_json_output_tool.js";
import type * as agent_tools_customers_customer_read_tool from "../agent_tools/customers/customer_read_tool.js";
import type * as agent_tools_customers_helpers_count_customers from "../agent_tools/customers/helpers/count_customers.js";
import type * as agent_tools_customers_helpers_read_customer_by_email from "../agent_tools/customers/helpers/read_customer_by_email.js";
import type * as agent_tools_customers_helpers_read_customer_by_id from "../agent_tools/customers/helpers/read_customer_by_id.js";
import type * as agent_tools_customers_helpers_read_customer_list from "../agent_tools/customers/helpers/read_customer_list.js";
import type * as agent_tools_customers_helpers_types from "../agent_tools/customers/helpers/types.js";
import type * as agent_tools_database_database_schema_tool from "../agent_tools/database/database_schema_tool.js";
import type * as agent_tools_database_helpers_schema_definitions from "../agent_tools/database/helpers/schema_definitions.js";
import type * as agent_tools_database_helpers_types from "../agent_tools/database/helpers/types.js";
import type * as agent_tools_files_docx_tool from "../agent_tools/files/docx_tool.js";
import type * as agent_tools_files_excel_tool from "../agent_tools/files/excel_tool.js";
import type * as agent_tools_files_helpers_analyze_image from "../agent_tools/files/helpers/analyze_image.js";
import type * as agent_tools_files_helpers_analyze_image_by_url from "../agent_tools/files/helpers/analyze_image_by_url.js";
import type * as agent_tools_files_helpers_analyze_text from "../agent_tools/files/helpers/analyze_text.js";
import type * as agent_tools_files_helpers_parse_file from "../agent_tools/files/helpers/parse_file.js";
import type * as agent_tools_files_helpers_vision_agent from "../agent_tools/files/helpers/vision_agent.js";
import type * as agent_tools_files_image_tool from "../agent_tools/files/image_tool.js";
import type * as agent_tools_files_internal_actions from "../agent_tools/files/internal_actions.js";
import type * as agent_tools_files_pdf_tool from "../agent_tools/files/pdf_tool.js";
import type * as agent_tools_files_pptx_tool from "../agent_tools/files/pptx_tool.js";
import type * as agent_tools_files_txt_tool from "../agent_tools/files/txt_tool.js";
import type * as agent_tools_human_input_internal_mutations from "../agent_tools/human_input/internal_mutations.js";
import type * as agent_tools_human_input_mutations from "../agent_tools/human_input/mutations.js";
import type * as agent_tools_human_input_request_human_input_tool from "../agent_tools/human_input/request_human_input_tool.js";
import type * as agent_tools_integrations_create_bound_integration_tool from "../agent_tools/integrations/create_bound_integration_tool.js";
import type * as agent_tools_integrations_fetch_operations_summary from "../agent_tools/integrations/fetch_operations_summary.js";
import type * as agent_tools_integrations_integration_batch_tool from "../agent_tools/integrations/integration_batch_tool.js";
import type * as agent_tools_integrations_integration_introspect_tool from "../agent_tools/integrations/integration_introspect_tool.js";
import type * as agent_tools_integrations_integration_tool from "../agent_tools/integrations/integration_tool.js";
import type * as agent_tools_integrations_internal_actions from "../agent_tools/integrations/internal_actions.js";
import type * as agent_tools_integrations_internal_mutations from "../agent_tools/integrations/internal_mutations.js";
import type * as agent_tools_integrations_types from "../agent_tools/integrations/types.js";
import type * as agent_tools_integrations_verify_approval_tool from "../agent_tools/integrations/verify_approval_tool.js";
import type * as agent_tools_load_convex_tools_as_object from "../agent_tools/load_convex_tools_as_object.js";
import type * as agent_tools_products_helpers_count_products from "../agent_tools/products/helpers/count_products.js";
import type * as agent_tools_products_helpers_read_product_by_id from "../agent_tools/products/helpers/read_product_by_id.js";
import type * as agent_tools_products_helpers_read_product_list from "../agent_tools/products/helpers/read_product_list.js";
import type * as agent_tools_products_helpers_types from "../agent_tools/products/helpers/types.js";
import type * as agent_tools_products_product_read_tool from "../agent_tools/products/product_read_tool.js";
import type * as agent_tools_rag_query_rag_context from "../agent_tools/rag/query_rag_context.js";
import type * as agent_tools_rag_rag_search_tool from "../agent_tools/rag/rag_search_tool.js";
import type * as agent_tools_sub_agents_crm_assistant_tool from "../agent_tools/sub_agents/crm_assistant_tool.js";
import type * as agent_tools_sub_agents_document_assistant_tool from "../agent_tools/sub_agents/document_assistant_tool.js";
import type * as agent_tools_sub_agents_helpers_build_additional_context from "../agent_tools/sub_agents/helpers/build_additional_context.js";
import type * as agent_tools_sub_agents_helpers_check_role_access from "../agent_tools/sub_agents/helpers/check_role_access.js";
import type * as agent_tools_sub_agents_helpers_format_integrations from "../agent_tools/sub_agents/helpers/format_integrations.js";
import type * as agent_tools_sub_agents_helpers_get_or_create_sub_thread from "../agent_tools/sub_agents/helpers/get_or_create_sub_thread.js";
import type * as agent_tools_sub_agents_helpers_tool_response from "../agent_tools/sub_agents/helpers/tool_response.js";
import type * as agent_tools_sub_agents_helpers_types from "../agent_tools/sub_agents/helpers/types.js";
import type * as agent_tools_sub_agents_helpers_validate_context from "../agent_tools/sub_agents/helpers/validate_context.js";
import type * as agent_tools_sub_agents_integration_assistant_tool from "../agent_tools/sub_agents/integration_assistant_tool.js";
import type * as agent_tools_sub_agents_web_assistant_tool from "../agent_tools/sub_agents/web_assistant_tool.js";
import type * as agent_tools_sub_agents_workflow_assistant_tool from "../agent_tools/sub_agents/workflow_assistant_tool.js";
import type * as agent_tools_tool_names from "../agent_tools/tool_names.js";
import type * as agent_tools_tool_registry from "../agent_tools/tool_registry.js";
import type * as agent_tools_types from "../agent_tools/types.js";
import type * as agent_tools_web_helpers_browser_operate from "../agent_tools/web/helpers/browser_operate.js";
import type * as agent_tools_web_helpers_fetch_url_via_pdf from "../agent_tools/web/helpers/fetch_url_via_pdf.js";
import type * as agent_tools_web_helpers_get_crawler_service_url from "../agent_tools/web/helpers/get_crawler_service_url.js";
import type * as agent_tools_web_helpers_get_operator_service_url from "../agent_tools/web/helpers/get_operator_service_url.js";
import type * as agent_tools_web_helpers_types from "../agent_tools/web/helpers/types.js";
import type * as agent_tools_web_web_tool from "../agent_tools/web/web_tool.js";
import type * as agent_tools_workflows_create_workflow_tool from "../agent_tools/workflows/create_workflow_tool.js";
import type * as agent_tools_workflows_helpers_read_active_version_steps from "../agent_tools/workflows/helpers/read_active_version_steps.js";
import type * as agent_tools_workflows_helpers_read_all_workflows from "../agent_tools/workflows/helpers/read_all_workflows.js";
import type * as agent_tools_workflows_helpers_read_version_history from "../agent_tools/workflows/helpers/read_version_history.js";
import type * as agent_tools_workflows_helpers_read_workflow_examples from "../agent_tools/workflows/helpers/read_workflow_examples.js";
import type * as agent_tools_workflows_helpers_read_workflow_structure from "../agent_tools/workflows/helpers/read_workflow_structure.js";
import type * as agent_tools_workflows_helpers_syntax_reference from "../agent_tools/workflows/helpers/syntax_reference.js";
import type * as agent_tools_workflows_helpers_types from "../agent_tools/workflows/helpers/types.js";
import type * as agent_tools_workflows_internal_actions from "../agent_tools/workflows/internal_actions.js";
import type * as agent_tools_workflows_internal_mutations from "../agent_tools/workflows/internal_mutations.js";
import type * as agent_tools_workflows_save_workflow_definition_tool from "../agent_tools/workflows/save_workflow_definition_tool.js";
import type * as agent_tools_workflows_update_workflow_step_tool from "../agent_tools/workflows/update_workflow_step_tool.js";
import type * as agent_tools_workflows_workflow_examples_tool from "../agent_tools/workflows/workflow_examples_tool.js";
import type * as agent_tools_workflows_workflow_read_tool from "../agent_tools/workflows/workflow_read_tool.js";
import type * as agents_builtin_agents from "../agents/builtin_agents.js";
import type * as agents_chat_agent from "../agents/chat/agent.js";
import type * as agents_chat_config from "../agents/chat/config.js";
import type * as agents_chat_internal_actions from "../agents/chat/internal_actions.js";
import type * as agents_chat_internal_mutations from "../agents/chat/internal_mutations.js";
import type * as agents_chat_mutations from "../agents/chat/mutations.js";
import type * as agents_chat_on_chat_complete from "../agents/chat/on_chat_complete.js";
import type * as agents_crm_agent from "../agents/crm/agent.js";
import type * as agents_crm_generate_response from "../agents/crm/generate_response.js";
import type * as agents_crm_internal_actions from "../agents/crm/internal_actions.js";
import type * as agents_crm_mutations from "../agents/crm/mutations.js";
import type * as agents_document_agent from "../agents/document/agent.js";
import type * as agents_document_generate_response from "../agents/document/generate_response.js";
import type * as agents_document_internal_actions from "../agents/document/internal_actions.js";
import type * as agents_document_mutations from "../agents/document/mutations.js";
import type * as agents_integration_agent from "../agents/integration/agent.js";
import type * as agents_integration_generate_response from "../agents/integration/generate_response.js";
import type * as agents_integration_internal_actions from "../agents/integration/internal_actions.js";
import type * as agents_integration_mutations from "../agents/integration/mutations.js";
import type * as agents_web_agent from "../agents/web/agent.js";
import type * as agents_web_generate_response from "../agents/web/generate_response.js";
import type * as agents_web_internal_actions from "../agents/web/internal_actions.js";
import type * as agents_web_mutations from "../agents/web/mutations.js";
import type * as agents_workflow_actions from "../agents/workflow/actions.js";
import type * as agents_workflow_agent from "../agents/workflow/agent.js";
import type * as agents_workflow_generate_response from "../agents/workflow/generate_response.js";
import type * as agents_workflow_internal_actions from "../agents/workflow/internal_actions.js";
import type * as agents_workflow_mutations from "../agents/workflow/mutations.js";
import type * as api_gateway from "../api_gateway.js";
import type * as approvals_actions from "../approvals/actions.js";
import type * as approvals_helpers from "../approvals/helpers.js";
import type * as approvals_internal_mutations from "../approvals/internal_mutations.js";
import type * as approvals_internal_queries from "../approvals/internal_queries.js";
import type * as approvals_list_approvals_paginated from "../approvals/list_approvals_paginated.js";
import type * as approvals_mutations from "../approvals/mutations.js";
import type * as approvals_queries from "../approvals/queries.js";
import type * as approvals_types from "../approvals/types.js";
import type * as approvals_validators from "../approvals/validators.js";
import type * as audit_logs_helpers from "../audit_logs/helpers.js";
import type * as audit_logs_internal_mutations from "../audit_logs/internal_mutations.js";
import type * as audit_logs_list_audit_logs_paginated from "../audit_logs/list_audit_logs_paginated.js";
import type * as audit_logs_queries from "../audit_logs/queries.js";
import type * as audit_logs_types from "../audit_logs/types.js";
import type * as audit_logs_validators from "../audit_logs/validators.js";
import type * as auth from "../auth.js";
import type * as branding_mutations from "../branding/mutations.js";
import type * as branding_queries from "../branding/queries.js";
import type * as constants from "../constants.js";
import type * as conversations_actions from "../conversations/actions.js";
import type * as conversations_add_message_to_conversation from "../conversations/add_message_to_conversation.js";
import type * as conversations_build_threading_headers from "../conversations/build_threading_headers.js";
import type * as conversations_bulk_close_conversations from "../conversations/bulk_close_conversations.js";
import type * as conversations_bulk_reopen_conversations from "../conversations/bulk_reopen_conversations.js";
import type * as conversations_close_conversation from "../conversations/close_conversation.js";
import type * as conversations_create_conversation from "../conversations/create_conversation.js";
import type * as conversations_create_conversation_public from "../conversations/create_conversation_public.js";
import type * as conversations_create_conversation_with_message from "../conversations/create_conversation_with_message.js";
import type * as conversations_delete_conversation from "../conversations/delete_conversation.js";
import type * as conversations_get_conversation_by_external_message_id from "../conversations/get_conversation_by_external_message_id.js";
import type * as conversations_get_conversation_by_id from "../conversations/get_conversation_by_id.js";
import type * as conversations_get_conversation_with_messages from "../conversations/get_conversation_with_messages.js";
import type * as conversations_get_message_by_external_id from "../conversations/get_message_by_external_id.js";
import type * as conversations_helpers from "../conversations/helpers.js";
import type * as conversations_improve_message from "../conversations/improve_message.js";
import type * as conversations_internal_actions from "../conversations/internal_actions.js";
import type * as conversations_internal_mutations from "../conversations/internal_mutations.js";
import type * as conversations_internal_queries from "../conversations/internal_queries.js";
import type * as conversations_list_conversations_paginated from "../conversations/list_conversations_paginated.js";
import type * as conversations_mark_conversation_as_read from "../conversations/mark_conversation_as_read.js";
import type * as conversations_mark_conversation_as_spam from "../conversations/mark_conversation_as_spam.js";
import type * as conversations_mutations from "../conversations/mutations.js";
import type * as conversations_queries from "../conversations/queries.js";
import type * as conversations_query_conversation_messages from "../conversations/query_conversation_messages.js";
import type * as conversations_query_conversations from "../conversations/query_conversations.js";
import type * as conversations_query_latest_message_by_delivery_state from "../conversations/query_latest_message_by_delivery_state.js";
import type * as conversations_reopen_conversation from "../conversations/reopen_conversation.js";
import type * as conversations_send_message_via_integration from "../conversations/send_message_via_integration.js";
import type * as conversations_transform_conversation from "../conversations/transform_conversation.js";
import type * as conversations_types from "../conversations/types.js";
import type * as conversations_update_conversation from "../conversations/update_conversation.js";
import type * as conversations_update_conversation_message from "../conversations/update_conversation_message.js";
import type * as conversations_update_conversations from "../conversations/update_conversations.js";
import type * as conversations_validators from "../conversations/validators.js";
import type * as crons from "../crons.js";
import type * as custom_agents_chat from "../custom_agents/chat.js";
import type * as custom_agents_config from "../custom_agents/config.js";
import type * as custom_agents_mutations from "../custom_agents/mutations.js";
import type * as custom_agents_queries from "../custom_agents/queries.js";
import type * as custom_agents_test_chat from "../custom_agents/test_chat.js";
import type * as custom_agents_webhooks_http_actions from "../custom_agents/webhooks/http_actions.js";
import type * as custom_agents_webhooks_internal_mutations from "../custom_agents/webhooks/internal_mutations.js";
import type * as custom_agents_webhooks_internal_queries from "../custom_agents/webhooks/internal_queries.js";
import type * as custom_agents_webhooks_mutations from "../custom_agents/webhooks/mutations.js";
import type * as custom_agents_webhooks_queries from "../custom_agents/webhooks/queries.js";
import type * as customers_bulk_create_customers from "../customers/bulk_create_customers.js";
import type * as customers_create_customer from "../customers/create_customer.js";
import type * as customers_create_customer_public from "../customers/create_customer_public.js";
import type * as customers_delete_customer from "../customers/delete_customer.js";
import type * as customers_filter_customers from "../customers/filter_customers.js";
import type * as customers_find_or_create_customer from "../customers/find_or_create_customer.js";
import type * as customers_get_customer from "../customers/get_customer.js";
import type * as customers_get_customer_by_email from "../customers/get_customer_by_email.js";
import type * as customers_get_customer_by_external_id from "../customers/get_customer_by_external_id.js";
import type * as customers_get_customer_by_id from "../customers/get_customer_by_id.js";
import type * as customers_helpers from "../customers/helpers.js";
import type * as customers_internal_mutations from "../customers/internal_mutations.js";
import type * as customers_internal_queries from "../customers/internal_queries.js";
import type * as customers_list_customers_paginated from "../customers/list_customers_paginated.js";
import type * as customers_mutations from "../customers/mutations.js";
import type * as customers_queries from "../customers/queries.js";
import type * as customers_query_customers from "../customers/query_customers.js";
import type * as customers_search_customers from "../customers/search_customers.js";
import type * as customers_types from "../customers/types.js";
import type * as customers_update_customer from "../customers/update_customer.js";
import type * as customers_update_customer_metadata from "../customers/update_customer_metadata.js";
import type * as customers_update_customers from "../customers/update_customers.js";
import type * as customers_validators from "../customers/validators.js";
import type * as documents_actions from "../documents/actions.js";
import type * as documents_check_membership from "../documents/check_membership.js";
import type * as documents_create_document from "../documents/create_document.js";
import type * as documents_create_onedrive_sync_config from "../documents/create_onedrive_sync_config.js";
import type * as documents_delete_document from "../documents/delete_document.js";
import type * as documents_extract_extension from "../documents/extract_extension.js";
import type * as documents_find_document_by_external_id from "../documents/find_document_by_external_id.js";
import type * as documents_find_document_by_title from "../documents/find_document_by_title.js";
import type * as documents_generate_document from "../documents/generate_document.js";
import type * as documents_generate_document_helpers from "../documents/generate_document_helpers.js";
import type * as documents_generate_docx from "../documents/generate_docx.js";
import type * as documents_generate_docx_from_template from "../documents/generate_docx_from_template.js";
import type * as documents_generate_pptx from "../documents/generate_pptx.js";
import type * as documents_generate_signed_url from "../documents/generate_signed_url.js";
import type * as documents_get_document_by_id from "../documents/get_document_by_id.js";
import type * as documents_get_document_by_id_transformed from "../documents/get_document_by_id_transformed.js";
import type * as documents_get_document_by_path from "../documents/get_document_by_path.js";
import type * as documents_get_documents from "../documents/get_documents.js";
import type * as documents_get_documents_cursor from "../documents/get_documents_cursor.js";
import type * as documents_get_onedrive_sync_configs from "../documents/get_onedrive_sync_configs.js";
import type * as documents_get_user_names_batch from "../documents/get_user_names_batch.js";
import type * as documents_helpers from "../documents/helpers.js";
import type * as documents_internal_actions from "../documents/internal_actions.js";
import type * as documents_internal_mutations from "../documents/internal_mutations.js";
import type * as documents_internal_queries from "../documents/internal_queries.js";
import type * as documents_list_documents_by_extension from "../documents/list_documents_by_extension.js";
import type * as documents_list_documents_paginated from "../documents/list_documents_paginated.js";
import type * as documents_migrate_team_fields from "../documents/migrate_team_fields.js";
import type * as documents_mutations from "../documents/mutations.js";
import type * as documents_queries from "../documents/queries.js";
import type * as documents_query_documents from "../documents/query_documents.js";
import type * as documents_read_file_base64_from_storage from "../documents/read_file_base64_from_storage.js";
import type * as documents_team_fields from "../documents/team_fields.js";
import type * as documents_transform_to_document_item from "../documents/transform_to_document_item.js";
import type * as documents_types from "../documents/types.js";
import type * as documents_update_document from "../documents/update_document.js";
import type * as documents_update_document_internal from "../documents/update_document_internal.js";
import type * as documents_update_document_rag_info from "../documents/update_document_rag_info.js";
import type * as documents_upload_base64_to_storage from "../documents/upload_base64_to_storage.js";
import type * as documents_validators from "../documents/validators.js";
import type * as files_mutations from "../files/mutations.js";
import type * as files_queries from "../files/queries.js";
import type * as http from "../http.js";
import type * as integrations_actions from "../integrations/actions.js";
import type * as integrations_build_test_secrets from "../integrations/build_test_secrets.js";
import type * as integrations_create_integration from "../integrations/create_integration.js";
import type * as integrations_create_integration_internal from "../integrations/create_integration_internal.js";
import type * as integrations_decrypt_and_refresh_oauth2 from "../integrations/decrypt_and_refresh_oauth2.js";
import type * as integrations_delete_integration from "../integrations/delete_integration.js";
import type * as integrations_encrypt_credentials from "../integrations/encrypt_credentials.js";
import type * as integrations_generate_oauth2_auth_url from "../integrations/generate_oauth2_auth_url.js";
import type * as integrations_get_decrypted_credentials from "../integrations/get_decrypted_credentials.js";
import type * as integrations_get_integration from "../integrations/get_integration.js";
import type * as integrations_get_integration_by_name from "../integrations/get_integration_by_name.js";
import type * as integrations_guards_is_rest_api_integration from "../integrations/guards/is_rest_api_integration.js";
import type * as integrations_guards_is_sql_integration from "../integrations/guards/is_sql_integration.js";
import type * as integrations_helpers from "../integrations/helpers.js";
import type * as integrations_internal_mutations from "../integrations/internal_mutations.js";
import type * as integrations_internal_queries from "../integrations/internal_queries.js";
import type * as integrations_list_integrations from "../integrations/list_integrations.js";
import type * as integrations_mutations from "../integrations/mutations.js";
import type * as integrations_oauth2_callback from "../integrations/oauth2_callback.js";
import type * as integrations_oauth2_token_exchange from "../integrations/oauth2_token_exchange.js";
import type * as integrations_provision_conversation_sync_workflow from "../integrations/provision_conversation_sync_workflow.js";
import type * as integrations_queries from "../integrations/queries.js";
import type * as integrations_run_health_check from "../integrations/run_health_check.js";
import type * as integrations_save_oauth2_client_credentials from "../integrations/save_oauth2_client_credentials.js";
import type * as integrations_test_connection from "../integrations/test_connection.js";
import type * as integrations_types from "../integrations/types.js";
import type * as integrations_update_integration from "../integrations/update_integration.js";
import type * as integrations_update_integration_internal from "../integrations/update_integration_internal.js";
import type * as integrations_update_sync_stats from "../integrations/update_sync_stats.js";
import type * as integrations_utils_get_integration_type from "../integrations/utils/get_integration_type.js";
import type * as integrations_validators from "../integrations/validators.js";
import type * as lib_action_cache_index from "../lib/action_cache/index.js";
import type * as lib_agent_chat_index from "../lib/agent_chat/index.js";
import type * as lib_agent_chat_internal_actions from "../lib/agent_chat/internal_actions.js";
import type * as lib_agent_chat_start_agent_chat from "../lib/agent_chat/start_agent_chat.js";
import type * as lib_agent_chat_types from "../lib/agent_chat/types.js";
import type * as lib_agent_completion_index from "../lib/agent_completion/index.js";
import type * as lib_agent_completion_on_agent_complete from "../lib/agent_completion/on_agent_complete.js";
import type * as lib_agent_response_generate_response from "../lib/agent_response/generate_response.js";
import type * as lib_agent_response_index from "../lib/agent_response/index.js";
import type * as lib_agent_response_structured_response_instructions from "../lib/agent_response/structured_response_instructions.js";
import type * as lib_agent_response_types from "../lib/agent_response/types.js";
import type * as lib_agent_response_validators from "../lib/agent_response/validators.js";
import type * as lib_agent_runtime_config from "../lib/agent_runtime_config.js";
import type * as lib_attachments_build_multi_modal_content from "../lib/attachments/build_multi_modal_content.js";
import type * as lib_attachments_format_markdown from "../lib/attachments/format_markdown.js";
import type * as lib_attachments_index from "../lib/attachments/index.js";
import type * as lib_attachments_process_attachments from "../lib/attachments/process_attachments.js";
import type * as lib_attachments_register_files from "../lib/attachments/register_files.js";
import type * as lib_attachments_types from "../lib/attachments/types.js";
import type * as lib_context_management_build_prioritized_contexts from "../lib/context_management/build_prioritized_contexts.js";
import type * as lib_context_management_check_and_summarize from "../lib/context_management/check_and_summarize.js";
import type * as lib_context_management_constants from "../lib/context_management/constants.js";
import type * as lib_context_management_context_builder from "../lib/context_management/context_builder.js";
import type * as lib_context_management_context_priority from "../lib/context_management/context_priority.js";
import type * as lib_context_management_estimate_context_size from "../lib/context_management/estimate_context_size.js";
import type * as lib_context_management_estimate_tokens from "../lib/context_management/estimate_tokens.js";
import type * as lib_context_management_index from "../lib/context_management/index.js";
import type * as lib_context_management_load_context_summary from "../lib/context_management/load_context_summary.js";
import type * as lib_context_management_message_formatter from "../lib/context_management/message_formatter.js";
import type * as lib_context_management_structured_context_builder from "../lib/context_management/structured_context_builder.js";
import type * as lib_create_agent_config from "../lib/create_agent_config.js";
import type * as lib_crypto_base64_to_bytes from "../lib/crypto/base64_to_bytes.js";
import type * as lib_crypto_base64_url_to_buffer from "../lib/crypto/base64_url_to_buffer.js";
import type * as lib_crypto_decrypt_string from "../lib/crypto/decrypt_string.js";
import type * as lib_crypto_encrypt_string from "../lib/crypto/encrypt_string.js";
import type * as lib_crypto_generate_secure_state from "../lib/crypto/generate_secure_state.js";
import type * as lib_crypto_get_secret_key from "../lib/crypto/get_secret_key.js";
import type * as lib_crypto_hex_to_bytes from "../lib/crypto/hex_to_bytes.js";
import type * as lib_crypto_internal_actions from "../lib/crypto/internal_actions.js";
import type * as lib_debug_log from "../lib/debug_log.js";
import type * as lib_error_classification from "../lib/error_classification.js";
import type * as lib_get_or_throw from "../lib/get_or_throw.js";
import type * as lib_get_user_teams from "../lib/get_user_teams.js";
import type * as lib_helpers_build_audit_context from "../lib/helpers/build_audit_context.js";
import type * as lib_helpers_count_items_in_org from "../lib/helpers/count_items_in_org.js";
import type * as lib_helpers_has_records_in_org from "../lib/helpers/has_records_in_org.js";
import type * as lib_message_deduplication from "../lib/message_deduplication.js";
import type * as lib_metadata_get_metadata_string from "../lib/metadata/get_metadata_string.js";
import type * as lib_openai_provider from "../lib/openai_provider.js";
import type * as lib_pagination_helpers from "../lib/pagination/helpers.js";
import type * as lib_pagination_index from "../lib/pagination/index.js";
import type * as lib_pagination_types from "../lib/pagination/types.js";
import type * as lib_rag_prefetch_index from "../lib/rag_prefetch/index.js";
import type * as lib_rate_limiter_helpers from "../lib/rate_limiter/helpers.js";
import type * as lib_rate_limiter_index from "../lib/rate_limiter/index.js";
import type * as lib_rls_auth_get_auth_user_identity from "../lib/rls/auth/get_auth_user_identity.js";
import type * as lib_rls_auth_get_authenticated_user from "../lib/rls/auth/get_authenticated_user.js";
import type * as lib_rls_auth_get_trusted_auth_data from "../lib/rls/auth/get_trusted_auth_data.js";
import type * as lib_rls_auth_require_authenticated_user from "../lib/rls/auth/require_authenticated_user.js";
import type * as lib_rls_context_create_org_query_builder from "../lib/rls/context/create_org_query_builder.js";
import type * as lib_rls_context_create_rls_context from "../lib/rls/context/create_rls_context.js";
import type * as lib_rls_errors from "../lib/rls/errors.js";
import type * as lib_rls_helpers_mutation_with_rls from "../lib/rls/helpers/mutation_with_rls.js";
import type * as lib_rls_helpers_query_with_rls from "../lib/rls/helpers/query_with_rls.js";
import type * as lib_rls_helpers_rls_rules from "../lib/rls/helpers/rls_rules.js";
import type * as lib_rls_helpers_z_mutation_with_rls from "../lib/rls/helpers/z_mutation_with_rls.js";
import type * as lib_rls_helpers_z_query_with_rls from "../lib/rls/helpers/z_query_with_rls.js";
import type * as lib_rls_index from "../lib/rls/index.js";
import type * as lib_rls_organization_get_organization_member from "../lib/rls/organization/get_organization_member.js";
import type * as lib_rls_organization_get_user_organizations from "../lib/rls/organization/get_user_organizations.js";
import type * as lib_rls_organization_validate_organization_access from "../lib/rls/organization/validate_organization_access.js";
import type * as lib_rls_organization_validate_resource_organization from "../lib/rls/organization/validate_resource_organization.js";
import type * as lib_rls_types from "../lib/rls/types.js";
import type * as lib_rls_validators from "../lib/rls/validators.js";
import type * as lib_rls_wrappers_with_organization_rls from "../lib/rls/wrappers/with_organization_rls.js";
import type * as lib_rls_wrappers_with_resource_rls from "../lib/rls/wrappers/with_resource_rls.js";
import type * as lib_shared_schemas_utils_json_value from "../lib/shared/schemas/utils/json_value.js";
import type * as lib_summarization_auto_summarize from "../lib/summarization/auto_summarize.js";
import type * as lib_summarization_index from "../lib/summarization/index.js";
import type * as lib_summarization_internal_actions from "../lib/summarization/internal_actions.js";
import type * as lib_summarize_context from "../lib/summarize_context.js";
import type * as lib_team_access from "../lib/team_access.js";
import type * as lib_type_cast_helpers from "../lib/type_cast_helpers.js";
import type * as lib_validators_common from "../lib/validators/common.js";
import type * as lib_variables_build_context from "../lib/variables/build_context.js";
import type * as lib_variables_evaluate_expression from "../lib/variables/evaluate_expression.js";
import type * as lib_variables_jexl_instance from "../lib/variables/jexl_instance.js";
import type * as lib_variables_replace_variables from "../lib/variables/replace_variables.js";
import type * as lib_variables_replace_variables_in_string from "../lib/variables/replace_variables_in_string.js";
import type * as lib_variables_validate_template from "../lib/variables/validate_template.js";
import type * as members_helpers from "../members/helpers.js";
import type * as members_internal_queries from "../members/internal_queries.js";
import type * as members_mutations from "../members/mutations.js";
import type * as members_queries from "../members/queries.js";
import type * as members_types from "../members/types.js";
import type * as members_validators from "../members/validators.js";
import type * as message_metadata_internal_mutations from "../message_metadata/internal_mutations.js";
import type * as message_metadata_queries from "../message_metadata/queries.js";
import type * as migrations_backfill_workflow_schedules from "../migrations/backfill_workflow_schedules.js";
import type * as migrations_remove_deprecated_llm_fields from "../migrations/remove_deprecated_llm_fields.js";
import type * as migrations_trigger_steps_to_start from "../migrations/trigger_steps_to_start.js";
import type * as node_only_documents_internal_actions from "../node_only/documents/internal_actions.js";
import type * as node_only_integration_sandbox_execute_integration_impl from "../node_only/integration_sandbox/execute_integration_impl.js";
import type * as node_only_integration_sandbox_helpers_base64_decode from "../node_only/integration_sandbox/helpers/base64_decode.js";
import type * as node_only_integration_sandbox_helpers_base64_encode from "../node_only/integration_sandbox/helpers/base64_encode.js";
import type * as node_only_integration_sandbox_helpers_create_convex_storage_provider from "../node_only/integration_sandbox/helpers/create_convex_storage_provider.js";
import type * as node_only_integration_sandbox_helpers_create_files_api from "../node_only/integration_sandbox/helpers/create_files_api.js";
import type * as node_only_integration_sandbox_helpers_create_http_api from "../node_only/integration_sandbox/helpers/create_http_api.js";
import type * as node_only_integration_sandbox_helpers_create_sandbox from "../node_only/integration_sandbox/helpers/create_sandbox.js";
import type * as node_only_integration_sandbox_helpers_create_secrets_api from "../node_only/integration_sandbox/helpers/create_secrets_api.js";
import type * as node_only_integration_sandbox_helpers_execute_file_operation from "../node_only/integration_sandbox/helpers/execute_file_operation.js";
import type * as node_only_integration_sandbox_helpers_execute_http_request from "../node_only/integration_sandbox/helpers/execute_http_request.js";
import type * as node_only_integration_sandbox_helpers_index from "../node_only/integration_sandbox/helpers/index.js";
import type * as node_only_integration_sandbox_helpers_run_with_passes from "../node_only/integration_sandbox/helpers/run_with_passes.js";
import type * as node_only_integration_sandbox_helpers_validate_host from "../node_only/integration_sandbox/helpers/validate_host.js";
import type * as node_only_integration_sandbox_internal_actions from "../node_only/integration_sandbox/internal_actions.js";
import type * as node_only_integration_sandbox_types from "../node_only/integration_sandbox/types.js";
import type * as node_only_sql_helpers_execute_mssql_query from "../node_only/sql/helpers/execute_mssql_query.js";
import type * as node_only_sql_helpers_execute_mysql_query from "../node_only/sql/helpers/execute_mysql_query.js";
import type * as node_only_sql_helpers_execute_postgres_query from "../node_only/sql/helpers/execute_postgres_query.js";
import type * as node_only_sql_helpers_execute_query from "../node_only/sql/helpers/execute_query.js";
import type * as node_only_sql_helpers_validate_query from "../node_only/sql/helpers/validate_query.js";
import type * as node_only_sql_internal_actions from "../node_only/sql/internal_actions.js";
import type * as node_only_sql_types from "../node_only/sql/types.js";
import type * as oauth2 from "../oauth2.js";
import type * as onedrive_actions from "../onedrive/actions.js";
import type * as onedrive_create_sync_configs from "../onedrive/create_sync_configs.js";
import type * as onedrive_download_and_store_file from "../onedrive/download_and_store_file.js";
import type * as onedrive_download_file from "../onedrive/download_file.js";
import type * as onedrive_get_file_metadata from "../onedrive/get_file_metadata.js";
import type * as onedrive_get_user_token from "../onedrive/get_user_token.js";
import type * as onedrive_helpers from "../onedrive/helpers.js";
import type * as onedrive_import_files from "../onedrive/import_files.js";
import type * as onedrive_import_files_deps from "../onedrive/import_files_deps.js";
import type * as onedrive_internal_actions from "../onedrive/internal_actions.js";
import type * as onedrive_internal_mutations from "../onedrive/internal_mutations.js";
import type * as onedrive_internal_queries from "../onedrive/internal_queries.js";
import type * as onedrive_list_files from "../onedrive/list_files.js";
import type * as onedrive_list_folder_contents from "../onedrive/list_folder_contents.js";
import type * as onedrive_list_sharepoint_drives from "../onedrive/list_sharepoint_drives.js";
import type * as onedrive_list_sharepoint_files from "../onedrive/list_sharepoint_files.js";
import type * as onedrive_list_sharepoint_sites from "../onedrive/list_sharepoint_sites.js";
import type * as onedrive_read_file from "../onedrive/read_file.js";
import type * as onedrive_refresh_token from "../onedrive/refresh_token.js";
import type * as onedrive_types from "../onedrive/types.js";
import type * as onedrive_update_sync_config from "../onedrive/update_sync_config.js";
import type * as onedrive_upload_and_create_document from "../onedrive/upload_and_create_document.js";
import type * as onedrive_upload_and_create_document_deps from "../onedrive/upload_and_create_document_deps.js";
import type * as onedrive_upload_to_storage from "../onedrive/upload_to_storage.js";
import type * as onedrive_validators from "../onedrive/validators.js";
import type * as onedrive_with_microsoft_token from "../onedrive/with_microsoft_token.js";
import type * as organizations_actions from "../organizations/actions.js";
import type * as organizations_create_organization from "../organizations/create_organization.js";
import type * as organizations_delete_organization from "../organizations/delete_organization.js";
import type * as organizations_delete_organization_logo from "../organizations/delete_organization_logo.js";
import type * as organizations_get_current_organization from "../organizations/get_current_organization.js";
import type * as organizations_get_organization from "../organizations/get_organization.js";
import type * as organizations_helpers from "../organizations/helpers.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as organizations_save_default_workflows from "../organizations/save_default_workflows.js";
import type * as organizations_update_organization from "../organizations/update_organization.js";
import type * as organizations_validators from "../organizations/validators.js";
import type * as predefined_workflows_circuly_sync_customers from "../predefined_workflows/circuly_sync_customers.js";
import type * as predefined_workflows_circuly_sync_products from "../predefined_workflows/circuly_sync_products.js";
import type * as predefined_workflows_circuly_sync_subscriptions from "../predefined_workflows/circuly_sync_subscriptions.js";
import type * as predefined_workflows_conversation_auto_archive from "../predefined_workflows/conversation_auto_archive.js";
import type * as predefined_workflows_conversation_sync from "../predefined_workflows/conversation_sync.js";
import type * as predefined_workflows_customer_rag_sync from "../predefined_workflows/customer_rag_sync.js";
import type * as predefined_workflows_document_rag_sync from "../predefined_workflows/document_rag_sync.js";
import type * as predefined_workflows_general_customer_status_assessment from "../predefined_workflows/general_customer_status_assessment.js";
import type * as predefined_workflows_general_product_recommendation from "../predefined_workflows/general_product_recommendation.js";
import type * as predefined_workflows_index from "../predefined_workflows/index.js";
import type * as predefined_workflows_loopi_customer_status_assessment from "../predefined_workflows/loopi_customer_status_assessment.js";
import type * as predefined_workflows_loopi_product_recommendation from "../predefined_workflows/loopi_product_recommendation.js";
import type * as predefined_workflows_onedrive_sync from "../predefined_workflows/onedrive_sync.js";
import type * as predefined_workflows_product_rag_sync from "../predefined_workflows/product_rag_sync.js";
import type * as predefined_workflows_product_recommendation_email from "../predefined_workflows/product_recommendation_email.js";
import type * as predefined_workflows_product_relationship_analysis from "../predefined_workflows/product_relationship_analysis.js";
import type * as predefined_workflows_shopify_sync_customers from "../predefined_workflows/shopify_sync_customers.js";
import type * as predefined_workflows_shopify_sync_products from "../predefined_workflows/shopify_sync_products.js";
import type * as predefined_workflows_website_pages_rag_sync from "../predefined_workflows/website_pages_rag_sync.js";
import type * as predefined_workflows_website_scan from "../predefined_workflows/website_scan.js";
import type * as predefined_workflows_workflow_rag_sync from "../predefined_workflows/workflow_rag_sync.js";
import type * as products_create_product from "../products/create_product.js";
import type * as products_create_product_with_translations from "../products/create_product_with_translations.js";
import type * as products_delete_product from "../products/delete_product.js";
import type * as products_filter_products from "../products/filter_products.js";
import type * as products_get_product from "../products/get_product.js";
import type * as products_get_product_by_id from "../products/get_product_by_id.js";
import type * as products_get_products_cursor from "../products/get_products_cursor.js";
import type * as products_helpers from "../products/helpers.js";
import type * as products_internal_mutations from "../products/internal_mutations.js";
import type * as products_internal_queries from "../products/internal_queries.js";
import type * as products_list_by_organization from "../products/list_by_organization.js";
import type * as products_list_products_paginated from "../products/list_products_paginated.js";
import type * as products_mutations from "../products/mutations.js";
import type * as products_queries from "../products/queries.js";
import type * as products_query_products from "../products/query_products.js";
import type * as products_search_products_by_metadata from "../products/search_products_by_metadata.js";
import type * as products_types from "../products/types.js";
import type * as products_update_product from "../products/update_product.js";
import type * as products_update_products from "../products/update_products.js";
import type * as products_upsert_product_translation from "../products/upsert_product_translation.js";
import type * as products_validators from "../products/validators.js";
import type * as sso_providers_actions from "../sso_providers/actions.js";
import type * as sso_providers_create_user_session from "../sso_providers/create_user_session.js";
import type * as sso_providers_entra_id_adapter from "../sso_providers/entra_id/adapter.js";
import type * as sso_providers_entra_id_constants from "../sso_providers/entra_id/constants.js";
import type * as sso_providers_entra_id_role_mapping from "../sso_providers/entra_id/role_mapping.js";
import type * as sso_providers_entra_id_team_sync from "../sso_providers/entra_id/team_sync.js";
import type * as sso_providers_find_or_create_sso_user from "../sso_providers/find_or_create_sso_user.js";
import type * as sso_providers_get from "../sso_providers/get.js";
import type * as sso_providers_get_auth_user from "../sso_providers/get_auth_user.js";
import type * as sso_providers_get_caller_role from "../sso_providers/get_caller_role.js";
import type * as sso_providers_get_microsoft_token from "../sso_providers/get_microsoft_token.js";
import type * as sso_providers_get_sso_config from "../sso_providers/get_sso_config.js";
import type * as sso_providers_get_sso_credentials_for_email from "../sso_providers/get_sso_credentials_for_email.js";
import type * as sso_providers_get_with_client_id from "../sso_providers/get_with_client_id.js";
import type * as sso_providers_handle_sso_login from "../sso_providers/handle_sso_login.js";
import type * as sso_providers_http_handlers from "../sso_providers/http_handlers.js";
import type * as sso_providers_internal_actions from "../sso_providers/internal_actions.js";
import type * as sso_providers_internal_mutations from "../sso_providers/internal_mutations.js";
import type * as sso_providers_internal_queries from "../sso_providers/internal_queries.js";
import type * as sso_providers_is_sso_configured from "../sso_providers/is_sso_configured.js";
import type * as sso_providers_queries from "../sso_providers/queries.js";
import type * as sso_providers_registry from "../sso_providers/registry.js";
import type * as sso_providers_remove_provider from "../sso_providers/remove_provider.js";
import type * as sso_providers_remove_sso_provider from "../sso_providers/remove_sso_provider.js";
import type * as sso_providers_sign_cookie_value from "../sso_providers/sign_cookie_value.js";
import type * as sso_providers_sso_authorize_handler from "../sso_providers/sso_authorize_handler.js";
import type * as sso_providers_sso_callback_handler from "../sso_providers/sso_callback_handler.js";
import type * as sso_providers_sso_discover_handler from "../sso_providers/sso_discover_handler.js";
import type * as sso_providers_sso_set_session_handler from "../sso_providers/sso_set_session_handler.js";
import type * as sso_providers_types from "../sso_providers/types.js";
import type * as sso_providers_upsert_provider from "../sso_providers/upsert_provider.js";
import type * as sso_providers_upsert_sso_provider from "../sso_providers/upsert_sso_provider.js";
import type * as sso_providers_validate_sso_config from "../sso_providers/validate_sso_config.js";
import type * as sso_providers_validators from "../sso_providers/validators.js";
import type * as streaming_helpers from "../streaming/helpers.js";
import type * as streaming_http_actions from "../streaming/http_actions.js";
import type * as streaming_internal_mutations from "../streaming/internal_mutations.js";
import type * as streaming_validators from "../streaming/validators.js";
import type * as team_members_mutations from "../team_members/mutations.js";
import type * as team_members_queries from "../team_members/queries.js";
import type * as threads_cleanup_orphaned_sub_threads from "../threads/cleanup_orphaned_sub_threads.js";
import type * as threads_create_chat_thread from "../threads/create_chat_thread.js";
import type * as threads_delete_chat_thread from "../threads/delete_chat_thread.js";
import type * as threads_get_latest_thread_with_message_count from "../threads/get_latest_thread_with_message_count.js";
import type * as threads_get_latest_tool_message from "../threads/get_latest_tool_message.js";
import type * as threads_get_or_create_sub_thread from "../threads/get_or_create_sub_thread.js";
import type * as threads_get_parent_thread_id from "../threads/get_parent_thread_id.js";
import type * as threads_get_thread_messages from "../threads/get_thread_messages.js";
import type * as threads_get_thread_messages_streaming from "../threads/get_thread_messages_streaming.js";
import type * as threads_helpers from "../threads/helpers.js";
import type * as threads_internal_mutations from "../threads/internal_mutations.js";
import type * as threads_list_threads from "../threads/list_threads.js";
import type * as threads_mutations from "../threads/mutations.js";
import type * as threads_queries from "../threads/queries.js";
import type * as threads_types from "../threads/types.js";
import type * as threads_update_chat_thread from "../threads/update_chat_thread.js";
import type * as threads_validators from "../threads/validators.js";
import type * as tone_of_voice_actions from "../tone_of_voice/actions.js";
import type * as tone_of_voice_add_example_message from "../tone_of_voice/add_example_message.js";
import type * as tone_of_voice_delete_example_message from "../tone_of_voice/delete_example_message.js";
import type * as tone_of_voice_generate_tone_of_voice from "../tone_of_voice/generate_tone_of_voice.js";
import type * as tone_of_voice_get_example_messages from "../tone_of_voice/get_example_messages.js";
import type * as tone_of_voice_get_tone_of_voice from "../tone_of_voice/get_tone_of_voice.js";
import type * as tone_of_voice_get_tone_of_voice_with_examples from "../tone_of_voice/get_tone_of_voice_with_examples.js";
import type * as tone_of_voice_helpers from "../tone_of_voice/helpers.js";
import type * as tone_of_voice_internal_actions from "../tone_of_voice/internal_actions.js";
import type * as tone_of_voice_internal_mutations from "../tone_of_voice/internal_mutations.js";
import type * as tone_of_voice_internal_queries from "../tone_of_voice/internal_queries.js";
import type * as tone_of_voice_load_example_messages_for_generation from "../tone_of_voice/load_example_messages_for_generation.js";
import type * as tone_of_voice_mutations from "../tone_of_voice/mutations.js";
import type * as tone_of_voice_queries from "../tone_of_voice/queries.js";
import type * as tone_of_voice_save_generated_tone from "../tone_of_voice/save_generated_tone.js";
import type * as tone_of_voice_types from "../tone_of_voice/types.js";
import type * as tone_of_voice_update_example_message from "../tone_of_voice/update_example_message.js";
import type * as tone_of_voice_upsert_tone_of_voice from "../tone_of_voice/upsert_tone_of_voice.js";
import type * as tone_of_voice_validators from "../tone_of_voice/validators.js";
import type * as users_add_member_internal from "../users/add_member_internal.js";
import type * as users_create_member from "../users/create_member.js";
import type * as users_create_user_without_session from "../users/create_user_without_session.js";
import type * as users_get_user_by_email from "../users/get_user_by_email.js";
import type * as users_has_any_users from "../users/has_any_users.js";
import type * as users_helpers from "../users/helpers.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as users_set_member_password from "../users/set_member_password.js";
import type * as users_types from "../users/types.js";
import type * as users_update_user_password from "../users/update_user_password.js";
import type * as users_validators from "../users/validators.js";
import type * as vendors_helpers from "../vendors/helpers.js";
import type * as vendors_list_vendors_paginated from "../vendors/list_vendors_paginated.js";
import type * as vendors_mutations from "../vendors/mutations.js";
import type * as vendors_queries from "../vendors/queries.js";
import type * as vendors_validators from "../vendors/validators.js";
import type * as websites_bulk_create_websites from "../websites/bulk_create_websites.js";
import type * as websites_bulk_upsert_pages from "../websites/bulk_upsert_pages.js";
import type * as websites_create_website from "../websites/create_website.js";
import type * as websites_delete_website from "../websites/delete_website.js";
import type * as websites_get_page_by_url from "../websites/get_page_by_url.js";
import type * as websites_get_pages_by_website from "../websites/get_pages_by_website.js";
import type * as websites_get_website from "../websites/get_website.js";
import type * as websites_get_website_by_domain from "../websites/get_website_by_domain.js";
import type * as websites_get_websites from "../websites/get_websites.js";
import type * as websites_helpers from "../websites/helpers.js";
import type * as websites_internal_actions from "../websites/internal_actions.js";
import type * as websites_internal_mutations from "../websites/internal_mutations.js";
import type * as websites_internal_queries from "../websites/internal_queries.js";
import type * as websites_list_websites_paginated from "../websites/list_websites_paginated.js";
import type * as websites_mutations from "../websites/mutations.js";
import type * as websites_provision_website_scan_workflow from "../websites/provision_website_scan_workflow.js";
import type * as websites_queries from "../websites/queries.js";
import type * as websites_rescan_website from "../websites/rescan_website.js";
import type * as websites_search_websites from "../websites/search_websites.js";
import type * as websites_types from "../websites/types.js";
import type * as websites_update_website from "../websites/update_website.js";
import type * as websites_validators from "../websites/validators.js";
import type * as wf_definitions_internal_mutations from "../wf_definitions/internal_mutations.js";
import type * as wf_definitions_internal_queries from "../wf_definitions/internal_queries.js";
import type * as wf_definitions_mutations from "../wf_definitions/mutations.js";
import type * as wf_definitions_queries from "../wf_definitions/queries.js";
import type * as wf_executions_internal_mutations from "../wf_executions/internal_mutations.js";
import type * as wf_executions_internal_queries from "../wf_executions/internal_queries.js";
import type * as wf_executions_queries from "../wf_executions/queries.js";
import type * as wf_step_defs_actions from "../wf_step_defs/actions.js";
import type * as wf_step_defs_audit from "../wf_step_defs/audit.js";
import type * as wf_step_defs_internal_mutations from "../wf_step_defs/internal_mutations.js";
import type * as wf_step_defs_internal_queries from "../wf_step_defs/internal_queries.js";
import type * as wf_step_defs_mutations from "../wf_step_defs/mutations.js";
import type * as wf_step_defs_queries from "../wf_step_defs/queries.js";
import type * as workflow_engine_action_defs_action_registry from "../workflow_engine/action_defs/action_registry.js";
import type * as workflow_engine_action_defs_approval_approval_action from "../workflow_engine/action_defs/approval/approval_action.js";
import type * as workflow_engine_action_defs_approval_helpers_create_approval from "../workflow_engine/action_defs/approval/helpers/create_approval.js";
import type * as workflow_engine_action_defs_approval_helpers_types from "../workflow_engine/action_defs/approval/helpers/types.js";
import type * as workflow_engine_action_defs_conversation_conversation_action from "../workflow_engine/action_defs/conversation/conversation_action.js";
import type * as workflow_engine_action_defs_conversation_helpers_add_message_to_conversation from "../workflow_engine/action_defs/conversation/helpers/add_message_to_conversation.js";
import type * as workflow_engine_action_defs_conversation_helpers_build_conversation_metadata from "../workflow_engine/action_defs/conversation/helpers/build_conversation_metadata.js";
import type * as workflow_engine_action_defs_conversation_helpers_build_email_metadata from "../workflow_engine/action_defs/conversation/helpers/build_email_metadata.js";
import type * as workflow_engine_action_defs_conversation_helpers_build_initial_message from "../workflow_engine/action_defs/conversation/helpers/build_initial_message.js";
import type * as workflow_engine_action_defs_conversation_helpers_check_conversation_exists from "../workflow_engine/action_defs/conversation/helpers/check_conversation_exists.js";
import type * as workflow_engine_action_defs_conversation_helpers_check_message_exists from "../workflow_engine/action_defs/conversation/helpers/check_message_exists.js";
import type * as workflow_engine_action_defs_conversation_helpers_create_conversation from "../workflow_engine/action_defs/conversation/helpers/create_conversation.js";
import type * as workflow_engine_action_defs_conversation_helpers_create_conversation_from_email from "../workflow_engine/action_defs/conversation/helpers/create_conversation_from_email.js";
import type * as workflow_engine_action_defs_conversation_helpers_create_conversation_from_sent_email from "../workflow_engine/action_defs/conversation/helpers/create_conversation_from_sent_email.js";
import type * as workflow_engine_action_defs_conversation_helpers_find_or_create_customer_from_email from "../workflow_engine/action_defs/conversation/helpers/find_or_create_customer_from_email.js";
import type * as workflow_engine_action_defs_conversation_helpers_find_related_conversation from "../workflow_engine/action_defs/conversation/helpers/find_related_conversation.js";
import type * as workflow_engine_action_defs_conversation_helpers_query_conversation_messages from "../workflow_engine/action_defs/conversation/helpers/query_conversation_messages.js";
import type * as workflow_engine_action_defs_conversation_helpers_query_latest_message_by_delivery_state from "../workflow_engine/action_defs/conversation/helpers/query_latest_message_by_delivery_state.js";
import type * as workflow_engine_action_defs_conversation_helpers_types from "../workflow_engine/action_defs/conversation/helpers/types.js";
import type * as workflow_engine_action_defs_conversation_helpers_update_conversations from "../workflow_engine/action_defs/conversation/helpers/update_conversations.js";
import type * as workflow_engine_action_defs_conversation_helpers_update_message from "../workflow_engine/action_defs/conversation/helpers/update_message.js";
import type * as workflow_engine_action_defs_crawler_crawler_action from "../workflow_engine/action_defs/crawler/crawler_action.js";
import type * as workflow_engine_action_defs_crawler_helpers_types from "../workflow_engine/action_defs/crawler/helpers/types.js";
import type * as workflow_engine_action_defs_customer_customer_action from "../workflow_engine/action_defs/customer/customer_action.js";
import type * as workflow_engine_action_defs_document_document_action from "../workflow_engine/action_defs/document/document_action.js";
import type * as workflow_engine_action_defs_integration_helpers_build_secrets_from_integration from "../workflow_engine/action_defs/integration/helpers/build_secrets_from_integration.js";
import type * as workflow_engine_action_defs_integration_helpers_decrypt_sql_credentials from "../workflow_engine/action_defs/integration/helpers/decrypt_sql_credentials.js";
import type * as workflow_engine_action_defs_integration_helpers_detect_write_operation from "../workflow_engine/action_defs/integration/helpers/detect_write_operation.js";
import type * as workflow_engine_action_defs_integration_helpers_execute_sql_integration from "../workflow_engine/action_defs/integration/helpers/execute_sql_integration.js";
import type * as workflow_engine_action_defs_integration_helpers_get_introspect_columns_query from "../workflow_engine/action_defs/integration/helpers/get_introspect_columns_query.js";
import type * as workflow_engine_action_defs_integration_helpers_get_introspect_tables_query from "../workflow_engine/action_defs/integration/helpers/get_introspect_tables_query.js";
import type * as workflow_engine_action_defs_integration_helpers_get_introspection_operations from "../workflow_engine/action_defs/integration/helpers/get_introspection_operations.js";
import type * as workflow_engine_action_defs_integration_helpers_is_introspection_operation from "../workflow_engine/action_defs/integration/helpers/is_introspection_operation.js";
import type * as workflow_engine_action_defs_integration_helpers_validate_operation_scopes from "../workflow_engine/action_defs/integration/helpers/validate_operation_scopes.js";
import type * as workflow_engine_action_defs_integration_helpers_validate_required_parameters from "../workflow_engine/action_defs/integration/helpers/validate_required_parameters.js";
import type * as workflow_engine_action_defs_integration_integration_action from "../workflow_engine/action_defs/integration/integration_action.js";
import type * as workflow_engine_action_defs_onedrive_onedrive_action from "../workflow_engine/action_defs/onedrive/onedrive_action.js";
import type * as workflow_engine_action_defs_product_product_action from "../workflow_engine/action_defs/product/product_action.js";
import type * as workflow_engine_action_defs_rag_helpers_delete_document from "../workflow_engine/action_defs/rag/helpers/delete_document.js";
import type * as workflow_engine_action_defs_rag_helpers_get_document_info from "../workflow_engine/action_defs/rag/helpers/get_document_info.js";
import type * as workflow_engine_action_defs_rag_helpers_get_rag_config from "../workflow_engine/action_defs/rag/helpers/get_rag_config.js";
import type * as workflow_engine_action_defs_rag_helpers_types from "../workflow_engine/action_defs/rag/helpers/types.js";
import type * as workflow_engine_action_defs_rag_helpers_upload_file_direct from "../workflow_engine/action_defs/rag/helpers/upload_file_direct.js";
import type * as workflow_engine_action_defs_rag_helpers_upload_text_document from "../workflow_engine/action_defs/rag/helpers/upload_text_document.js";
import type * as workflow_engine_action_defs_rag_rag_action from "../workflow_engine/action_defs/rag/rag_action.js";
import type * as workflow_engine_action_defs_set_variables_action from "../workflow_engine/action_defs/set_variables_action.js";
import type * as workflow_engine_action_defs_tone_of_voice_tone_of_voice_action from "../workflow_engine/action_defs/tone_of_voice/tone_of_voice_action.js";
import type * as workflow_engine_action_defs_website_helpers_types from "../workflow_engine/action_defs/website/helpers/types.js";
import type * as workflow_engine_action_defs_website_website_action from "../workflow_engine/action_defs/website/website_action.js";
import type * as workflow_engine_action_defs_website_pages_helpers_types from "../workflow_engine/action_defs/website_pages/helpers/types.js";
import type * as workflow_engine_action_defs_website_pages_website_pages_action from "../workflow_engine/action_defs/website_pages/website_pages_action.js";
import type * as workflow_engine_action_defs_workflow_helpers_types from "../workflow_engine/action_defs/workflow/helpers/types.js";
import type * as workflow_engine_action_defs_workflow_helpers_upload_workflows from "../workflow_engine/action_defs/workflow/helpers/upload_workflows.js";
import type * as workflow_engine_action_defs_workflow_workflow_action from "../workflow_engine/action_defs/workflow/workflow_action.js";
import type * as workflow_engine_action_defs_workflow_processing_records_helpers_find_unprocessed from "../workflow_engine/action_defs/workflow_processing_records/helpers/find_unprocessed.js";
import type * as workflow_engine_action_defs_workflow_processing_records_helpers_record_processed from "../workflow_engine/action_defs/workflow_processing_records/helpers/record_processed.js";
import type * as workflow_engine_action_defs_workflow_processing_records_helpers_types from "../workflow_engine/action_defs/workflow_processing_records/helpers/types.js";
import type * as workflow_engine_action_defs_workflow_processing_records_workflow_processing_records_action from "../workflow_engine/action_defs/workflow_processing_records/workflow_processing_records_action.js";
import type * as workflow_engine_engine from "../workflow_engine/engine.js";
import type * as workflow_engine_execution_dry_run_executor from "../workflow_engine/execution/dry_run_executor.js";
import type * as workflow_engine_helpers_data_source_database_workflow_data_source from "../workflow_engine/helpers/data_source/database_workflow_data_source.js";
import type * as workflow_engine_helpers_data_source_types from "../workflow_engine/helpers/data_source/types.js";
import type * as workflow_engine_helpers_engine_build_steps_config_map from "../workflow_engine/helpers/engine/build_steps_config_map.js";
import type * as workflow_engine_helpers_engine_cleanup_component_workflow from "../workflow_engine/helpers/engine/cleanup_component_workflow.js";
import type * as workflow_engine_helpers_engine_dynamic_workflow_handler from "../workflow_engine/helpers/engine/dynamic_workflow_handler.js";
import type * as workflow_engine_helpers_engine_execute_step_handler from "../workflow_engine/helpers/engine/execute_step_handler.js";
import type * as workflow_engine_helpers_engine_execute_workflow_start from "../workflow_engine/helpers/engine/execute_workflow_start.js";
import type * as workflow_engine_helpers_engine_index from "../workflow_engine/helpers/engine/index.js";
import type * as workflow_engine_helpers_engine_load_database_workflow from "../workflow_engine/helpers/engine/load_database_workflow.js";
import type * as workflow_engine_helpers_engine_on_workflow_complete from "../workflow_engine/helpers/engine/on_workflow_complete.js";
import type * as workflow_engine_helpers_engine_serialize_and_complete_execution_handler from "../workflow_engine/helpers/engine/serialize_and_complete_execution_handler.js";
import type * as workflow_engine_helpers_engine_shard from "../workflow_engine/helpers/engine/shard.js";
import type * as workflow_engine_helpers_engine_start_workflow_handler from "../workflow_engine/helpers/engine/start_workflow_handler.js";
import type * as workflow_engine_helpers_engine_workflow_data from "../workflow_engine/helpers/engine/workflow_data.js";
import type * as workflow_engine_helpers_formatting_stringify from "../workflow_engine/helpers/formatting/stringify.js";
import type * as workflow_engine_helpers_nodes_action_execute_action_node from "../workflow_engine/helpers/nodes/action/execute_action_node.js";
import type * as workflow_engine_helpers_nodes_action_get_action from "../workflow_engine/helpers/nodes/action/get_action.js";
import type * as workflow_engine_helpers_nodes_action_list_actions from "../workflow_engine/helpers/nodes/action/list_actions.js";
import type * as workflow_engine_helpers_nodes_action_types from "../workflow_engine/helpers/nodes/action/types.js";
import type * as workflow_engine_helpers_nodes_condition_execute_condition_node from "../workflow_engine/helpers/nodes/condition/execute_condition_node.js";
import type * as workflow_engine_helpers_nodes_constants from "../workflow_engine/helpers/nodes/constants.js";
import type * as workflow_engine_helpers_nodes_llm_execute_agent_with_tools from "../workflow_engine/helpers/nodes/llm/execute_agent_with_tools.js";
import type * as workflow_engine_helpers_nodes_llm_execute_llm_node from "../workflow_engine/helpers/nodes/llm/execute_llm_node.js";
import type * as workflow_engine_helpers_nodes_llm_extract_json_from_text from "../workflow_engine/helpers/nodes/llm/extract_json_from_text.js";
import type * as workflow_engine_helpers_nodes_llm_types from "../workflow_engine/helpers/nodes/llm/types.js";
import type * as workflow_engine_helpers_nodes_llm_types_workflow_termination from "../workflow_engine/helpers/nodes/llm/types/workflow_termination.js";
import type * as workflow_engine_helpers_nodes_llm_utils_build_agent_steps_summary from "../workflow_engine/helpers/nodes/llm/utils/build_agent_steps_summary.js";
import type * as workflow_engine_helpers_nodes_llm_utils_create_llm_result from "../workflow_engine/helpers/nodes/llm/utils/create_llm_result.js";
import type * as workflow_engine_helpers_nodes_llm_utils_extract_schema_fields from "../workflow_engine/helpers/nodes/llm/utils/extract_schema_fields.js";
import type * as workflow_engine_helpers_nodes_llm_utils_extract_tool_diagnostics from "../workflow_engine/helpers/nodes/llm/utils/extract_tool_diagnostics.js";
import type * as workflow_engine_helpers_nodes_llm_utils_process_agent_result from "../workflow_engine/helpers/nodes/llm/utils/process_agent_result.js";
import type * as workflow_engine_helpers_nodes_llm_utils_process_prompts from "../workflow_engine/helpers/nodes/llm/utils/process_prompts.js";
import type * as workflow_engine_helpers_nodes_llm_utils_validate_and_normalize_config from "../workflow_engine/helpers/nodes/llm/utils/validate_and_normalize_config.js";
import type * as workflow_engine_helpers_nodes_loop_execute_loop_node from "../workflow_engine/helpers/nodes/loop/execute_loop_node.js";
import type * as workflow_engine_helpers_nodes_loop_loop_node_executor from "../workflow_engine/helpers/nodes/loop/loop_node_executor.js";
import type * as workflow_engine_helpers_nodes_loop_utils_create_loop_result from "../workflow_engine/helpers/nodes/loop/utils/create_loop_result.js";
import type * as workflow_engine_helpers_nodes_loop_utils_create_loop_state from "../workflow_engine/helpers/nodes/loop/utils/create_loop_state.js";
import type * as workflow_engine_helpers_nodes_loop_utils_get_input_data from "../workflow_engine/helpers/nodes/loop/utils/get_input_data.js";
import type * as workflow_engine_helpers_nodes_loop_utils_get_loop_items from "../workflow_engine/helpers/nodes/loop/utils/get_loop_items.js";
import type * as workflow_engine_helpers_nodes_loop_utils_is_loop_in_progress from "../workflow_engine/helpers/nodes/loop/utils/is_loop_in_progress.js";
import type * as workflow_engine_helpers_recovery_index from "../workflow_engine/helpers/recovery/index.js";
import type * as workflow_engine_helpers_recovery_recover_stuck_executions from "../workflow_engine/helpers/recovery/recover_stuck_executions.js";
import type * as workflow_engine_helpers_scheduler_get_last_execution_time from "../workflow_engine/helpers/scheduler/get_last_execution_time.js";
import type * as workflow_engine_helpers_scheduler_get_scheduled_workflows from "../workflow_engine/helpers/scheduler/get_scheduled_workflows.js";
import type * as workflow_engine_helpers_scheduler_has_running_execution from "../workflow_engine/helpers/scheduler/has_running_execution.js";
import type * as workflow_engine_helpers_scheduler_index from "../workflow_engine/helpers/scheduler/index.js";
import type * as workflow_engine_helpers_scheduler_scan_and_trigger from "../workflow_engine/helpers/scheduler/scan_and_trigger.js";
import type * as workflow_engine_helpers_scheduler_should_trigger_workflow from "../workflow_engine/helpers/scheduler/should_trigger_workflow.js";
import type * as workflow_engine_helpers_scheduler_trigger_workflow_by_id from "../workflow_engine/helpers/scheduler/trigger_workflow_by_id.js";
import type * as workflow_engine_helpers_serialization_deserialize_variables from "../workflow_engine/helpers/serialization/deserialize_variables.js";
import type * as workflow_engine_helpers_serialization_sanitize_depth from "../workflow_engine/helpers/serialization/sanitize_depth.js";
import type * as workflow_engine_helpers_serialization_serialize_output from "../workflow_engine/helpers/serialization/serialize_output.js";
import type * as workflow_engine_helpers_serialization_serialize_variables from "../workflow_engine/helpers/serialization/serialize_variables.js";
import type * as workflow_engine_helpers_serialization_strip_transient_variables from "../workflow_engine/helpers/serialization/strip_transient_variables.js";
import type * as workflow_engine_helpers_step_execution_build_steps_map from "../workflow_engine/helpers/step_execution/build_steps_map.js";
import type * as workflow_engine_helpers_step_execution_decrypt_and_merge_secrets from "../workflow_engine/helpers/step_execution/decrypt_and_merge_secrets.js";
import type * as workflow_engine_helpers_step_execution_execute_step_by_type from "../workflow_engine/helpers/step_execution/execute_step_by_type.js";
import type * as workflow_engine_helpers_step_execution_extract_essential_loop_variables from "../workflow_engine/helpers/step_execution/extract_essential_loop_variables.js";
import type * as workflow_engine_helpers_step_execution_extract_loop_variables from "../workflow_engine/helpers/step_execution/extract_loop_variables.js";
import type * as workflow_engine_helpers_step_execution_extract_steps_with_outputs from "../workflow_engine/helpers/step_execution/extract_steps_with_outputs.js";
import type * as workflow_engine_helpers_step_execution_initialize_execution_variables from "../workflow_engine/helpers/step_execution/initialize_execution_variables.js";
import type * as workflow_engine_helpers_step_execution_load_and_validate_execution from "../workflow_engine/helpers/step_execution/load_and_validate_execution.js";
import type * as workflow_engine_helpers_step_execution_merge_execution_variables from "../workflow_engine/helpers/step_execution/merge_execution_variables.js";
import type * as workflow_engine_helpers_step_execution_persist_execution_result from "../workflow_engine/helpers/step_execution/persist_execution_result.js";
import type * as workflow_engine_helpers_step_execution_types from "../workflow_engine/helpers/step_execution/types.js";
import type * as workflow_engine_helpers_validation_circular_dependency_validator from "../workflow_engine/helpers/validation/circular_dependency_validator.js";
import type * as workflow_engine_helpers_validation_constants from "../workflow_engine/helpers/validation/constants.js";
import type * as workflow_engine_helpers_validation_index from "../workflow_engine/helpers/validation/index.js";
import type * as workflow_engine_helpers_validation_steps_action from "../workflow_engine/helpers/validation/steps/action.js";
import type * as workflow_engine_helpers_validation_steps_condition from "../workflow_engine/helpers/validation/steps/condition.js";
import type * as workflow_engine_helpers_validation_steps_index from "../workflow_engine/helpers/validation/steps/index.js";
import type * as workflow_engine_helpers_validation_steps_llm from "../workflow_engine/helpers/validation/steps/llm.js";
import type * as workflow_engine_helpers_validation_steps_loop from "../workflow_engine/helpers/validation/steps/loop.js";
import type * as workflow_engine_helpers_validation_steps_start from "../workflow_engine/helpers/validation/steps/start.js";
import type * as workflow_engine_helpers_validation_types from "../workflow_engine/helpers/validation/types.js";
import type * as workflow_engine_helpers_validation_validate_action_parameters from "../workflow_engine/helpers/validation/validate_action_parameters.js";
import type * as workflow_engine_helpers_validation_validate_step_config from "../workflow_engine/helpers/validation/validate_step_config.js";
import type * as workflow_engine_helpers_validation_validate_workflow_definition from "../workflow_engine/helpers/validation/validate_workflow_definition.js";
import type * as workflow_engine_helpers_validation_validate_workflow_steps from "../workflow_engine/helpers/validation/validate_workflow_steps.js";
import type * as workflow_engine_helpers_validation_variables_action_schemas from "../workflow_engine/helpers/validation/variables/action_schemas.js";
import type * as workflow_engine_helpers_validation_variables_index from "../workflow_engine/helpers/validation/variables/index.js";
import type * as workflow_engine_helpers_validation_variables_parse from "../workflow_engine/helpers/validation/variables/parse.js";
import type * as workflow_engine_helpers_validation_variables_step_schemas from "../workflow_engine/helpers/validation/variables/step_schemas.js";
import type * as workflow_engine_helpers_validation_variables_types from "../workflow_engine/helpers/validation/variables/types.js";
import type * as workflow_engine_helpers_validation_variables_validate from "../workflow_engine/helpers/validation/variables/validate.js";
import type * as workflow_engine_helpers_variables_decrypt_inline_secrets from "../workflow_engine/helpers/variables/decrypt_inline_secrets.js";
import type * as workflow_engine_instructions_core_instructions from "../workflow_engine/instructions/core_instructions.js";
import type * as workflow_engine_internal_actions from "../workflow_engine/internal_actions.js";
import type * as workflow_engine_internal_mutations from "../workflow_engine/internal_mutations.js";
import type * as workflow_engine_internal_queries from "../workflow_engine/internal_queries.js";
import type * as workflow_engine_mutations from "../workflow_engine/mutations.js";
import type * as workflow_engine_types_execution from "../workflow_engine/types/execution.js";
import type * as workflow_engine_types_index from "../workflow_engine/types/index.js";
import type * as workflow_engine_types_nodes from "../workflow_engine/types/nodes.js";
import type * as workflow_engine_types_workflow from "../workflow_engine/types/workflow.js";
import type * as workflow_engine_types_workflow_types from "../workflow_engine/types/workflow_types.js";
import type * as workflow_engine_workflow_syntax_compact from "../workflow_engine/workflow_syntax_compact.js";
import type * as workflows_definitions_activate_version from "../workflows/definitions/activate_version.js";
import type * as workflows_definitions_create_draft_from_active from "../workflows/definitions/create_draft_from_active.js";
import type * as workflows_definitions_create_workflow from "../workflows/definitions/create_workflow.js";
import type * as workflows_definitions_create_workflow_draft from "../workflows/definitions/create_workflow_draft.js";
import type * as workflows_definitions_create_workflow_with_steps from "../workflows/definitions/create_workflow_with_steps.js";
import type * as workflows_definitions_delete_workflow from "../workflows/definitions/delete_workflow.js";
import type * as workflows_definitions_duplicate_workflow from "../workflows/definitions/duplicate_workflow.js";
import type * as workflows_definitions_get_active_version from "../workflows/definitions/get_active_version.js";
import type * as workflows_definitions_get_automations_cursor from "../workflows/definitions/get_automations_cursor.js";
import type * as workflows_definitions_get_draft from "../workflows/definitions/get_draft.js";
import type * as workflows_definitions_get_version_by_number from "../workflows/definitions/get_version_by_number.js";
import type * as workflows_definitions_get_workflow from "../workflows/definitions/get_workflow.js";
import type * as workflows_definitions_get_workflow_by_name from "../workflows/definitions/get_workflow_by_name.js";
import type * as workflows_definitions_get_workflow_with_first_step from "../workflows/definitions/get_workflow_with_first_step.js";
import type * as workflows_definitions_helpers from "../workflows/definitions/helpers.js";
import type * as workflows_definitions_list_automations from "../workflows/definitions/list_automations.js";
import type * as workflows_definitions_list_versions from "../workflows/definitions/list_versions.js";
import type * as workflows_definitions_list_workflows from "../workflows/definitions/list_workflows.js";
import type * as workflows_definitions_list_workflows_with_best_version from "../workflows/definitions/list_workflows_with_best_version.js";
import type * as workflows_definitions_publish_draft from "../workflows/definitions/publish_draft.js";
import type * as workflows_definitions_republish_workflow from "../workflows/definitions/republish_workflow.js";
import type * as workflows_definitions_save_manual_configuration from "../workflows/definitions/save_manual_configuration.js";
import type * as workflows_definitions_save_workflow_with_steps from "../workflows/definitions/save_workflow_with_steps.js";
import type * as workflows_definitions_types from "../workflows/definitions/types.js";
import type * as workflows_definitions_unpublish_workflow from "../workflows/definitions/unpublish_workflow.js";
import type * as workflows_definitions_update_draft from "../workflows/definitions/update_draft.js";
import type * as workflows_definitions_update_workflow from "../workflows/definitions/update_workflow.js";
import type * as workflows_definitions_update_workflow_status from "../workflows/definitions/update_workflow_status.js";
import type * as workflows_definitions_validators from "../workflows/definitions/validators.js";
import type * as workflows_executions_cleanup_execution_storage from "../workflows/executions/cleanup_execution_storage.js";
import type * as workflows_executions_complete_execution from "../workflows/executions/complete_execution.js";
import type * as workflows_executions_fail_execution from "../workflows/executions/fail_execution.js";
import type * as workflows_executions_get_execution from "../workflows/executions/get_execution.js";
import type * as workflows_executions_get_execution_step_journal from "../workflows/executions/get_execution_step_journal.js";
import type * as workflows_executions_get_raw_execution from "../workflows/executions/get_raw_execution.js";
import type * as workflows_executions_get_workflow_execution_stats from "../workflows/executions/get_workflow_execution_stats.js";
import type * as workflows_executions_helpers from "../workflows/executions/helpers.js";
import type * as workflows_executions_list_executions from "../workflows/executions/list_executions.js";
import type * as workflows_executions_list_executions_cursor from "../workflows/executions/list_executions_cursor.js";
import type * as workflows_executions_list_executions_paginated_native from "../workflows/executions/list_executions_paginated_native.js";
import type * as workflows_executions_patch_execution from "../workflows/executions/patch_execution.js";
import type * as workflows_executions_resume_execution from "../workflows/executions/resume_execution.js";
import type * as workflows_executions_set_component_workflow from "../workflows/executions/set_component_workflow.js";
import type * as workflows_executions_types from "../workflows/executions/types.js";
import type * as workflows_executions_update_execution_metadata from "../workflows/executions/update_execution_metadata.js";
import type * as workflows_executions_update_execution_status from "../workflows/executions/update_execution_status.js";
import type * as workflows_executions_update_execution_variables from "../workflows/executions/update_execution_variables.js";
import type * as workflows_executions_validators from "../workflows/executions/validators.js";
import type * as workflows_helpers from "../workflows/helpers.js";
import type * as workflows_processing_records_ast_helpers_extract_comparison from "../workflows/processing_records/ast_helpers/extract_comparison.js";
import type * as workflows_processing_records_ast_helpers_extract_literal_value from "../workflows/processing_records/ast_helpers/extract_literal_value.js";
import type * as workflows_processing_records_ast_helpers_get_full_field_path from "../workflows/processing_records/ast_helpers/get_full_field_path.js";
import type * as workflows_processing_records_ast_helpers_index from "../workflows/processing_records/ast_helpers/index.js";
import type * as workflows_processing_records_ast_helpers_is_simple_field from "../workflows/processing_records/ast_helpers/is_simple_field.js";
import type * as workflows_processing_records_ast_helpers_merge_and_conditions from "../workflows/processing_records/ast_helpers/merge_and_conditions.js";
import type * as workflows_processing_records_ast_helpers_traverse_ast from "../workflows/processing_records/ast_helpers/traverse_ast.js";
import type * as workflows_processing_records_ast_helpers_types from "../workflows/processing_records/ast_helpers/types.js";
import type * as workflows_processing_records_calculate_cutoff_timestamp from "../workflows/processing_records/calculate_cutoff_timestamp.js";
import type * as workflows_processing_records_constants from "../workflows/processing_records/constants.js";
import type * as workflows_processing_records_find_and_claim_unprocessed from "../workflows/processing_records/find_and_claim_unprocessed.js";
import type * as workflows_processing_records_get_latest_processed_creation_time from "../workflows/processing_records/get_latest_processed_creation_time.js";
import type * as workflows_processing_records_get_processing_record_by_id from "../workflows/processing_records/get_processing_record_by_id.js";
import type * as workflows_processing_records_get_table_indexes from "../workflows/processing_records/get_table_indexes.js";
import type * as workflows_processing_records_helpers from "../workflows/processing_records/helpers.js";
import type * as workflows_processing_records_index_selection_group_conditions_by_field from "../workflows/processing_records/index_selection/group_conditions_by_field.js";
import type * as workflows_processing_records_index_selection_index from "../workflows/processing_records/index_selection/index.js";
import type * as workflows_processing_records_index_selection_score_index from "../workflows/processing_records/index_selection/score_index.js";
import type * as workflows_processing_records_index_selection_select_optimal_index from "../workflows/processing_records/index_selection/select_optimal_index.js";
import type * as workflows_processing_records_index_selection_types from "../workflows/processing_records/index_selection/types.js";
import type * as workflows_processing_records_internal_mutations from "../workflows/processing_records/internal_mutations.js";
import type * as workflows_processing_records_internal_queries from "../workflows/processing_records/internal_queries.js";
import type * as workflows_processing_records_is_record_processed from "../workflows/processing_records/is_record_processed.js";
import type * as workflows_processing_records_parse_filter_expression from "../workflows/processing_records/parse_filter_expression.js";
import type * as workflows_processing_records_query_building_create_expression_filter from "../workflows/processing_records/query_building/create_expression_filter.js";
import type * as workflows_processing_records_query_building_create_query_builder from "../workflows/processing_records/query_building/create_query_builder.js";
import type * as workflows_processing_records_query_building_find_unprocessed from "../workflows/processing_records/query_building/find_unprocessed.js";
import type * as workflows_processing_records_query_building_index from "../workflows/processing_records/query_building/index.js";
import type * as workflows_processing_records_query_building_types from "../workflows/processing_records/query_building/types.js";
import type * as workflows_processing_records_record_claimed from "../workflows/processing_records/record_claimed.js";
import type * as workflows_processing_records_record_processed from "../workflows/processing_records/record_processed.js";
import type * as workflows_processing_records_run_query from "../workflows/processing_records/run_query.js";
import type * as workflows_processing_records_types from "../workflows/processing_records/types.js";
import type * as workflows_steps_create_step from "../workflows/steps/create_step.js";
import type * as workflows_steps_delete_step from "../workflows/steps/delete_step.js";
import type * as workflows_steps_get_ordered_steps from "../workflows/steps/get_ordered_steps.js";
import type * as workflows_steps_helpers from "../workflows/steps/helpers.js";
import type * as workflows_steps_list_workflow_steps from "../workflows/steps/list_workflow_steps.js";
import type * as workflows_steps_types from "../workflows/steps/types.js";
import type * as workflows_steps_update_step from "../workflows/steps/update_step.js";
import type * as workflows_steps_validators from "../workflows/steps/validators.js";
import type * as workflows_triggers_actions from "../workflows/triggers/actions.js";
import type * as workflows_triggers_api_http from "../workflows/triggers/api_http.js";
import type * as workflows_triggers_emit_event from "../workflows/triggers/emit_event.js";
import type * as workflows_triggers_event_types from "../workflows/triggers/event_types.js";
import type * as workflows_triggers_helpers_crypto from "../workflows/triggers/helpers/crypto.js";
import type * as workflows_triggers_helpers_validate from "../workflows/triggers/helpers/validate.js";
import type * as workflows_triggers_http_actions from "../workflows/triggers/http_actions.js";
import type * as workflows_triggers_internal_mutations from "../workflows/triggers/internal_mutations.js";
import type * as workflows_triggers_internal_queries from "../workflows/triggers/internal_queries.js";
import type * as workflows_triggers_mutations from "../workflows/triggers/mutations.js";
import type * as workflows_triggers_process_event from "../workflows/triggers/process_event.js";
import type * as workflows_triggers_queries from "../workflows/triggers/queries.js";
import type * as workflows_validators from "../workflows/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "accounts/helpers": typeof accounts_helpers;
  "accounts/queries": typeof accounts_queries;
  "accounts/types": typeof accounts_types;
  "accounts/validators": typeof accounts_validators;
  "agent_tools/create_json_output_tool": typeof agent_tools_create_json_output_tool;
  "agent_tools/customers/customer_read_tool": typeof agent_tools_customers_customer_read_tool;
  "agent_tools/customers/helpers/count_customers": typeof agent_tools_customers_helpers_count_customers;
  "agent_tools/customers/helpers/read_customer_by_email": typeof agent_tools_customers_helpers_read_customer_by_email;
  "agent_tools/customers/helpers/read_customer_by_id": typeof agent_tools_customers_helpers_read_customer_by_id;
  "agent_tools/customers/helpers/read_customer_list": typeof agent_tools_customers_helpers_read_customer_list;
  "agent_tools/customers/helpers/types": typeof agent_tools_customers_helpers_types;
  "agent_tools/database/database_schema_tool": typeof agent_tools_database_database_schema_tool;
  "agent_tools/database/helpers/schema_definitions": typeof agent_tools_database_helpers_schema_definitions;
  "agent_tools/database/helpers/types": typeof agent_tools_database_helpers_types;
  "agent_tools/files/docx_tool": typeof agent_tools_files_docx_tool;
  "agent_tools/files/excel_tool": typeof agent_tools_files_excel_tool;
  "agent_tools/files/helpers/analyze_image": typeof agent_tools_files_helpers_analyze_image;
  "agent_tools/files/helpers/analyze_image_by_url": typeof agent_tools_files_helpers_analyze_image_by_url;
  "agent_tools/files/helpers/analyze_text": typeof agent_tools_files_helpers_analyze_text;
  "agent_tools/files/helpers/parse_file": typeof agent_tools_files_helpers_parse_file;
  "agent_tools/files/helpers/vision_agent": typeof agent_tools_files_helpers_vision_agent;
  "agent_tools/files/image_tool": typeof agent_tools_files_image_tool;
  "agent_tools/files/internal_actions": typeof agent_tools_files_internal_actions;
  "agent_tools/files/pdf_tool": typeof agent_tools_files_pdf_tool;
  "agent_tools/files/pptx_tool": typeof agent_tools_files_pptx_tool;
  "agent_tools/files/txt_tool": typeof agent_tools_files_txt_tool;
  "agent_tools/human_input/internal_mutations": typeof agent_tools_human_input_internal_mutations;
  "agent_tools/human_input/mutations": typeof agent_tools_human_input_mutations;
  "agent_tools/human_input/request_human_input_tool": typeof agent_tools_human_input_request_human_input_tool;
  "agent_tools/integrations/create_bound_integration_tool": typeof agent_tools_integrations_create_bound_integration_tool;
  "agent_tools/integrations/fetch_operations_summary": typeof agent_tools_integrations_fetch_operations_summary;
  "agent_tools/integrations/integration_batch_tool": typeof agent_tools_integrations_integration_batch_tool;
  "agent_tools/integrations/integration_introspect_tool": typeof agent_tools_integrations_integration_introspect_tool;
  "agent_tools/integrations/integration_tool": typeof agent_tools_integrations_integration_tool;
  "agent_tools/integrations/internal_actions": typeof agent_tools_integrations_internal_actions;
  "agent_tools/integrations/internal_mutations": typeof agent_tools_integrations_internal_mutations;
  "agent_tools/integrations/types": typeof agent_tools_integrations_types;
  "agent_tools/integrations/verify_approval_tool": typeof agent_tools_integrations_verify_approval_tool;
  "agent_tools/load_convex_tools_as_object": typeof agent_tools_load_convex_tools_as_object;
  "agent_tools/products/helpers/count_products": typeof agent_tools_products_helpers_count_products;
  "agent_tools/products/helpers/read_product_by_id": typeof agent_tools_products_helpers_read_product_by_id;
  "agent_tools/products/helpers/read_product_list": typeof agent_tools_products_helpers_read_product_list;
  "agent_tools/products/helpers/types": typeof agent_tools_products_helpers_types;
  "agent_tools/products/product_read_tool": typeof agent_tools_products_product_read_tool;
  "agent_tools/rag/query_rag_context": typeof agent_tools_rag_query_rag_context;
  "agent_tools/rag/rag_search_tool": typeof agent_tools_rag_rag_search_tool;
  "agent_tools/sub_agents/crm_assistant_tool": typeof agent_tools_sub_agents_crm_assistant_tool;
  "agent_tools/sub_agents/document_assistant_tool": typeof agent_tools_sub_agents_document_assistant_tool;
  "agent_tools/sub_agents/helpers/build_additional_context": typeof agent_tools_sub_agents_helpers_build_additional_context;
  "agent_tools/sub_agents/helpers/check_role_access": typeof agent_tools_sub_agents_helpers_check_role_access;
  "agent_tools/sub_agents/helpers/format_integrations": typeof agent_tools_sub_agents_helpers_format_integrations;
  "agent_tools/sub_agents/helpers/get_or_create_sub_thread": typeof agent_tools_sub_agents_helpers_get_or_create_sub_thread;
  "agent_tools/sub_agents/helpers/tool_response": typeof agent_tools_sub_agents_helpers_tool_response;
  "agent_tools/sub_agents/helpers/types": typeof agent_tools_sub_agents_helpers_types;
  "agent_tools/sub_agents/helpers/validate_context": typeof agent_tools_sub_agents_helpers_validate_context;
  "agent_tools/sub_agents/integration_assistant_tool": typeof agent_tools_sub_agents_integration_assistant_tool;
  "agent_tools/sub_agents/web_assistant_tool": typeof agent_tools_sub_agents_web_assistant_tool;
  "agent_tools/sub_agents/workflow_assistant_tool": typeof agent_tools_sub_agents_workflow_assistant_tool;
  "agent_tools/tool_names": typeof agent_tools_tool_names;
  "agent_tools/tool_registry": typeof agent_tools_tool_registry;
  "agent_tools/types": typeof agent_tools_types;
  "agent_tools/web/helpers/browser_operate": typeof agent_tools_web_helpers_browser_operate;
  "agent_tools/web/helpers/fetch_url_via_pdf": typeof agent_tools_web_helpers_fetch_url_via_pdf;
  "agent_tools/web/helpers/get_crawler_service_url": typeof agent_tools_web_helpers_get_crawler_service_url;
  "agent_tools/web/helpers/get_operator_service_url": typeof agent_tools_web_helpers_get_operator_service_url;
  "agent_tools/web/helpers/types": typeof agent_tools_web_helpers_types;
  "agent_tools/web/web_tool": typeof agent_tools_web_web_tool;
  "agent_tools/workflows/create_workflow_tool": typeof agent_tools_workflows_create_workflow_tool;
  "agent_tools/workflows/helpers/read_active_version_steps": typeof agent_tools_workflows_helpers_read_active_version_steps;
  "agent_tools/workflows/helpers/read_all_workflows": typeof agent_tools_workflows_helpers_read_all_workflows;
  "agent_tools/workflows/helpers/read_version_history": typeof agent_tools_workflows_helpers_read_version_history;
  "agent_tools/workflows/helpers/read_workflow_examples": typeof agent_tools_workflows_helpers_read_workflow_examples;
  "agent_tools/workflows/helpers/read_workflow_structure": typeof agent_tools_workflows_helpers_read_workflow_structure;
  "agent_tools/workflows/helpers/syntax_reference": typeof agent_tools_workflows_helpers_syntax_reference;
  "agent_tools/workflows/helpers/types": typeof agent_tools_workflows_helpers_types;
  "agent_tools/workflows/internal_actions": typeof agent_tools_workflows_internal_actions;
  "agent_tools/workflows/internal_mutations": typeof agent_tools_workflows_internal_mutations;
  "agent_tools/workflows/save_workflow_definition_tool": typeof agent_tools_workflows_save_workflow_definition_tool;
  "agent_tools/workflows/update_workflow_step_tool": typeof agent_tools_workflows_update_workflow_step_tool;
  "agent_tools/workflows/workflow_examples_tool": typeof agent_tools_workflows_workflow_examples_tool;
  "agent_tools/workflows/workflow_read_tool": typeof agent_tools_workflows_workflow_read_tool;
  "agents/builtin_agents": typeof agents_builtin_agents;
  "agents/chat/agent": typeof agents_chat_agent;
  "agents/chat/config": typeof agents_chat_config;
  "agents/chat/internal_actions": typeof agents_chat_internal_actions;
  "agents/chat/internal_mutations": typeof agents_chat_internal_mutations;
  "agents/chat/mutations": typeof agents_chat_mutations;
  "agents/chat/on_chat_complete": typeof agents_chat_on_chat_complete;
  "agents/crm/agent": typeof agents_crm_agent;
  "agents/crm/generate_response": typeof agents_crm_generate_response;
  "agents/crm/internal_actions": typeof agents_crm_internal_actions;
  "agents/crm/mutations": typeof agents_crm_mutations;
  "agents/document/agent": typeof agents_document_agent;
  "agents/document/generate_response": typeof agents_document_generate_response;
  "agents/document/internal_actions": typeof agents_document_internal_actions;
  "agents/document/mutations": typeof agents_document_mutations;
  "agents/integration/agent": typeof agents_integration_agent;
  "agents/integration/generate_response": typeof agents_integration_generate_response;
  "agents/integration/internal_actions": typeof agents_integration_internal_actions;
  "agents/integration/mutations": typeof agents_integration_mutations;
  "agents/web/agent": typeof agents_web_agent;
  "agents/web/generate_response": typeof agents_web_generate_response;
  "agents/web/internal_actions": typeof agents_web_internal_actions;
  "agents/web/mutations": typeof agents_web_mutations;
  "agents/workflow/actions": typeof agents_workflow_actions;
  "agents/workflow/agent": typeof agents_workflow_agent;
  "agents/workflow/generate_response": typeof agents_workflow_generate_response;
  "agents/workflow/internal_actions": typeof agents_workflow_internal_actions;
  "agents/workflow/mutations": typeof agents_workflow_mutations;
  api_gateway: typeof api_gateway;
  "approvals/actions": typeof approvals_actions;
  "approvals/helpers": typeof approvals_helpers;
  "approvals/internal_mutations": typeof approvals_internal_mutations;
  "approvals/internal_queries": typeof approvals_internal_queries;
  "approvals/list_approvals_paginated": typeof approvals_list_approvals_paginated;
  "approvals/mutations": typeof approvals_mutations;
  "approvals/queries": typeof approvals_queries;
  "approvals/types": typeof approvals_types;
  "approvals/validators": typeof approvals_validators;
  "audit_logs/helpers": typeof audit_logs_helpers;
  "audit_logs/internal_mutations": typeof audit_logs_internal_mutations;
  "audit_logs/list_audit_logs_paginated": typeof audit_logs_list_audit_logs_paginated;
  "audit_logs/queries": typeof audit_logs_queries;
  "audit_logs/types": typeof audit_logs_types;
  "audit_logs/validators": typeof audit_logs_validators;
  auth: typeof auth;
  "branding/mutations": typeof branding_mutations;
  "branding/queries": typeof branding_queries;
  constants: typeof constants;
  "conversations/actions": typeof conversations_actions;
  "conversations/add_message_to_conversation": typeof conversations_add_message_to_conversation;
  "conversations/build_threading_headers": typeof conversations_build_threading_headers;
  "conversations/bulk_close_conversations": typeof conversations_bulk_close_conversations;
  "conversations/bulk_reopen_conversations": typeof conversations_bulk_reopen_conversations;
  "conversations/close_conversation": typeof conversations_close_conversation;
  "conversations/create_conversation": typeof conversations_create_conversation;
  "conversations/create_conversation_public": typeof conversations_create_conversation_public;
  "conversations/create_conversation_with_message": typeof conversations_create_conversation_with_message;
  "conversations/delete_conversation": typeof conversations_delete_conversation;
  "conversations/get_conversation_by_external_message_id": typeof conversations_get_conversation_by_external_message_id;
  "conversations/get_conversation_by_id": typeof conversations_get_conversation_by_id;
  "conversations/get_conversation_with_messages": typeof conversations_get_conversation_with_messages;
  "conversations/get_message_by_external_id": typeof conversations_get_message_by_external_id;
  "conversations/helpers": typeof conversations_helpers;
  "conversations/improve_message": typeof conversations_improve_message;
  "conversations/internal_actions": typeof conversations_internal_actions;
  "conversations/internal_mutations": typeof conversations_internal_mutations;
  "conversations/internal_queries": typeof conversations_internal_queries;
  "conversations/list_conversations_paginated": typeof conversations_list_conversations_paginated;
  "conversations/mark_conversation_as_read": typeof conversations_mark_conversation_as_read;
  "conversations/mark_conversation_as_spam": typeof conversations_mark_conversation_as_spam;
  "conversations/mutations": typeof conversations_mutations;
  "conversations/queries": typeof conversations_queries;
  "conversations/query_conversation_messages": typeof conversations_query_conversation_messages;
  "conversations/query_conversations": typeof conversations_query_conversations;
  "conversations/query_latest_message_by_delivery_state": typeof conversations_query_latest_message_by_delivery_state;
  "conversations/reopen_conversation": typeof conversations_reopen_conversation;
  "conversations/send_message_via_integration": typeof conversations_send_message_via_integration;
  "conversations/transform_conversation": typeof conversations_transform_conversation;
  "conversations/types": typeof conversations_types;
  "conversations/update_conversation": typeof conversations_update_conversation;
  "conversations/update_conversation_message": typeof conversations_update_conversation_message;
  "conversations/update_conversations": typeof conversations_update_conversations;
  "conversations/validators": typeof conversations_validators;
  crons: typeof crons;
  "custom_agents/chat": typeof custom_agents_chat;
  "custom_agents/config": typeof custom_agents_config;
  "custom_agents/mutations": typeof custom_agents_mutations;
  "custom_agents/queries": typeof custom_agents_queries;
  "custom_agents/test_chat": typeof custom_agents_test_chat;
  "custom_agents/webhooks/http_actions": typeof custom_agents_webhooks_http_actions;
  "custom_agents/webhooks/internal_mutations": typeof custom_agents_webhooks_internal_mutations;
  "custom_agents/webhooks/internal_queries": typeof custom_agents_webhooks_internal_queries;
  "custom_agents/webhooks/mutations": typeof custom_agents_webhooks_mutations;
  "custom_agents/webhooks/queries": typeof custom_agents_webhooks_queries;
  "customers/bulk_create_customers": typeof customers_bulk_create_customers;
  "customers/create_customer": typeof customers_create_customer;
  "customers/create_customer_public": typeof customers_create_customer_public;
  "customers/delete_customer": typeof customers_delete_customer;
  "customers/filter_customers": typeof customers_filter_customers;
  "customers/find_or_create_customer": typeof customers_find_or_create_customer;
  "customers/get_customer": typeof customers_get_customer;
  "customers/get_customer_by_email": typeof customers_get_customer_by_email;
  "customers/get_customer_by_external_id": typeof customers_get_customer_by_external_id;
  "customers/get_customer_by_id": typeof customers_get_customer_by_id;
  "customers/helpers": typeof customers_helpers;
  "customers/internal_mutations": typeof customers_internal_mutations;
  "customers/internal_queries": typeof customers_internal_queries;
  "customers/list_customers_paginated": typeof customers_list_customers_paginated;
  "customers/mutations": typeof customers_mutations;
  "customers/queries": typeof customers_queries;
  "customers/query_customers": typeof customers_query_customers;
  "customers/search_customers": typeof customers_search_customers;
  "customers/types": typeof customers_types;
  "customers/update_customer": typeof customers_update_customer;
  "customers/update_customer_metadata": typeof customers_update_customer_metadata;
  "customers/update_customers": typeof customers_update_customers;
  "customers/validators": typeof customers_validators;
  "documents/actions": typeof documents_actions;
  "documents/check_membership": typeof documents_check_membership;
  "documents/create_document": typeof documents_create_document;
  "documents/create_onedrive_sync_config": typeof documents_create_onedrive_sync_config;
  "documents/delete_document": typeof documents_delete_document;
  "documents/extract_extension": typeof documents_extract_extension;
  "documents/find_document_by_external_id": typeof documents_find_document_by_external_id;
  "documents/find_document_by_title": typeof documents_find_document_by_title;
  "documents/generate_document": typeof documents_generate_document;
  "documents/generate_document_helpers": typeof documents_generate_document_helpers;
  "documents/generate_docx": typeof documents_generate_docx;
  "documents/generate_docx_from_template": typeof documents_generate_docx_from_template;
  "documents/generate_pptx": typeof documents_generate_pptx;
  "documents/generate_signed_url": typeof documents_generate_signed_url;
  "documents/get_document_by_id": typeof documents_get_document_by_id;
  "documents/get_document_by_id_transformed": typeof documents_get_document_by_id_transformed;
  "documents/get_document_by_path": typeof documents_get_document_by_path;
  "documents/get_documents": typeof documents_get_documents;
  "documents/get_documents_cursor": typeof documents_get_documents_cursor;
  "documents/get_onedrive_sync_configs": typeof documents_get_onedrive_sync_configs;
  "documents/get_user_names_batch": typeof documents_get_user_names_batch;
  "documents/helpers": typeof documents_helpers;
  "documents/internal_actions": typeof documents_internal_actions;
  "documents/internal_mutations": typeof documents_internal_mutations;
  "documents/internal_queries": typeof documents_internal_queries;
  "documents/list_documents_by_extension": typeof documents_list_documents_by_extension;
  "documents/list_documents_paginated": typeof documents_list_documents_paginated;
  "documents/migrate_team_fields": typeof documents_migrate_team_fields;
  "documents/mutations": typeof documents_mutations;
  "documents/queries": typeof documents_queries;
  "documents/query_documents": typeof documents_query_documents;
  "documents/read_file_base64_from_storage": typeof documents_read_file_base64_from_storage;
  "documents/team_fields": typeof documents_team_fields;
  "documents/transform_to_document_item": typeof documents_transform_to_document_item;
  "documents/types": typeof documents_types;
  "documents/update_document": typeof documents_update_document;
  "documents/update_document_internal": typeof documents_update_document_internal;
  "documents/update_document_rag_info": typeof documents_update_document_rag_info;
  "documents/upload_base64_to_storage": typeof documents_upload_base64_to_storage;
  "documents/validators": typeof documents_validators;
  "files/mutations": typeof files_mutations;
  "files/queries": typeof files_queries;
  http: typeof http;
  "integrations/actions": typeof integrations_actions;
  "integrations/build_test_secrets": typeof integrations_build_test_secrets;
  "integrations/create_integration": typeof integrations_create_integration;
  "integrations/create_integration_internal": typeof integrations_create_integration_internal;
  "integrations/decrypt_and_refresh_oauth2": typeof integrations_decrypt_and_refresh_oauth2;
  "integrations/delete_integration": typeof integrations_delete_integration;
  "integrations/encrypt_credentials": typeof integrations_encrypt_credentials;
  "integrations/generate_oauth2_auth_url": typeof integrations_generate_oauth2_auth_url;
  "integrations/get_decrypted_credentials": typeof integrations_get_decrypted_credentials;
  "integrations/get_integration": typeof integrations_get_integration;
  "integrations/get_integration_by_name": typeof integrations_get_integration_by_name;
  "integrations/guards/is_rest_api_integration": typeof integrations_guards_is_rest_api_integration;
  "integrations/guards/is_sql_integration": typeof integrations_guards_is_sql_integration;
  "integrations/helpers": typeof integrations_helpers;
  "integrations/internal_mutations": typeof integrations_internal_mutations;
  "integrations/internal_queries": typeof integrations_internal_queries;
  "integrations/list_integrations": typeof integrations_list_integrations;
  "integrations/mutations": typeof integrations_mutations;
  "integrations/oauth2_callback": typeof integrations_oauth2_callback;
  "integrations/oauth2_token_exchange": typeof integrations_oauth2_token_exchange;
  "integrations/provision_conversation_sync_workflow": typeof integrations_provision_conversation_sync_workflow;
  "integrations/queries": typeof integrations_queries;
  "integrations/run_health_check": typeof integrations_run_health_check;
  "integrations/save_oauth2_client_credentials": typeof integrations_save_oauth2_client_credentials;
  "integrations/test_connection": typeof integrations_test_connection;
  "integrations/types": typeof integrations_types;
  "integrations/update_integration": typeof integrations_update_integration;
  "integrations/update_integration_internal": typeof integrations_update_integration_internal;
  "integrations/update_sync_stats": typeof integrations_update_sync_stats;
  "integrations/utils/get_integration_type": typeof integrations_utils_get_integration_type;
  "integrations/validators": typeof integrations_validators;
  "lib/action_cache/index": typeof lib_action_cache_index;
  "lib/agent_chat/index": typeof lib_agent_chat_index;
  "lib/agent_chat/internal_actions": typeof lib_agent_chat_internal_actions;
  "lib/agent_chat/start_agent_chat": typeof lib_agent_chat_start_agent_chat;
  "lib/agent_chat/types": typeof lib_agent_chat_types;
  "lib/agent_completion/index": typeof lib_agent_completion_index;
  "lib/agent_completion/on_agent_complete": typeof lib_agent_completion_on_agent_complete;
  "lib/agent_response/generate_response": typeof lib_agent_response_generate_response;
  "lib/agent_response/index": typeof lib_agent_response_index;
  "lib/agent_response/structured_response_instructions": typeof lib_agent_response_structured_response_instructions;
  "lib/agent_response/types": typeof lib_agent_response_types;
  "lib/agent_response/validators": typeof lib_agent_response_validators;
  "lib/agent_runtime_config": typeof lib_agent_runtime_config;
  "lib/attachments/build_multi_modal_content": typeof lib_attachments_build_multi_modal_content;
  "lib/attachments/format_markdown": typeof lib_attachments_format_markdown;
  "lib/attachments/index": typeof lib_attachments_index;
  "lib/attachments/process_attachments": typeof lib_attachments_process_attachments;
  "lib/attachments/register_files": typeof lib_attachments_register_files;
  "lib/attachments/types": typeof lib_attachments_types;
  "lib/context_management/build_prioritized_contexts": typeof lib_context_management_build_prioritized_contexts;
  "lib/context_management/check_and_summarize": typeof lib_context_management_check_and_summarize;
  "lib/context_management/constants": typeof lib_context_management_constants;
  "lib/context_management/context_builder": typeof lib_context_management_context_builder;
  "lib/context_management/context_priority": typeof lib_context_management_context_priority;
  "lib/context_management/estimate_context_size": typeof lib_context_management_estimate_context_size;
  "lib/context_management/estimate_tokens": typeof lib_context_management_estimate_tokens;
  "lib/context_management/index": typeof lib_context_management_index;
  "lib/context_management/load_context_summary": typeof lib_context_management_load_context_summary;
  "lib/context_management/message_formatter": typeof lib_context_management_message_formatter;
  "lib/context_management/structured_context_builder": typeof lib_context_management_structured_context_builder;
  "lib/create_agent_config": typeof lib_create_agent_config;
  "lib/crypto/base64_to_bytes": typeof lib_crypto_base64_to_bytes;
  "lib/crypto/base64_url_to_buffer": typeof lib_crypto_base64_url_to_buffer;
  "lib/crypto/decrypt_string": typeof lib_crypto_decrypt_string;
  "lib/crypto/encrypt_string": typeof lib_crypto_encrypt_string;
  "lib/crypto/generate_secure_state": typeof lib_crypto_generate_secure_state;
  "lib/crypto/get_secret_key": typeof lib_crypto_get_secret_key;
  "lib/crypto/hex_to_bytes": typeof lib_crypto_hex_to_bytes;
  "lib/crypto/internal_actions": typeof lib_crypto_internal_actions;
  "lib/debug_log": typeof lib_debug_log;
  "lib/error_classification": typeof lib_error_classification;
  "lib/get_or_throw": typeof lib_get_or_throw;
  "lib/get_user_teams": typeof lib_get_user_teams;
  "lib/helpers/build_audit_context": typeof lib_helpers_build_audit_context;
  "lib/helpers/count_items_in_org": typeof lib_helpers_count_items_in_org;
  "lib/helpers/has_records_in_org": typeof lib_helpers_has_records_in_org;
  "lib/message_deduplication": typeof lib_message_deduplication;
  "lib/metadata/get_metadata_string": typeof lib_metadata_get_metadata_string;
  "lib/openai_provider": typeof lib_openai_provider;
  "lib/pagination/helpers": typeof lib_pagination_helpers;
  "lib/pagination/index": typeof lib_pagination_index;
  "lib/pagination/types": typeof lib_pagination_types;
  "lib/rag_prefetch/index": typeof lib_rag_prefetch_index;
  "lib/rate_limiter/helpers": typeof lib_rate_limiter_helpers;
  "lib/rate_limiter/index": typeof lib_rate_limiter_index;
  "lib/rls/auth/get_auth_user_identity": typeof lib_rls_auth_get_auth_user_identity;
  "lib/rls/auth/get_authenticated_user": typeof lib_rls_auth_get_authenticated_user;
  "lib/rls/auth/get_trusted_auth_data": typeof lib_rls_auth_get_trusted_auth_data;
  "lib/rls/auth/require_authenticated_user": typeof lib_rls_auth_require_authenticated_user;
  "lib/rls/context/create_org_query_builder": typeof lib_rls_context_create_org_query_builder;
  "lib/rls/context/create_rls_context": typeof lib_rls_context_create_rls_context;
  "lib/rls/errors": typeof lib_rls_errors;
  "lib/rls/helpers/mutation_with_rls": typeof lib_rls_helpers_mutation_with_rls;
  "lib/rls/helpers/query_with_rls": typeof lib_rls_helpers_query_with_rls;
  "lib/rls/helpers/rls_rules": typeof lib_rls_helpers_rls_rules;
  "lib/rls/helpers/z_mutation_with_rls": typeof lib_rls_helpers_z_mutation_with_rls;
  "lib/rls/helpers/z_query_with_rls": typeof lib_rls_helpers_z_query_with_rls;
  "lib/rls/index": typeof lib_rls_index;
  "lib/rls/organization/get_organization_member": typeof lib_rls_organization_get_organization_member;
  "lib/rls/organization/get_user_organizations": typeof lib_rls_organization_get_user_organizations;
  "lib/rls/organization/validate_organization_access": typeof lib_rls_organization_validate_organization_access;
  "lib/rls/organization/validate_resource_organization": typeof lib_rls_organization_validate_resource_organization;
  "lib/rls/types": typeof lib_rls_types;
  "lib/rls/validators": typeof lib_rls_validators;
  "lib/rls/wrappers/with_organization_rls": typeof lib_rls_wrappers_with_organization_rls;
  "lib/rls/wrappers/with_resource_rls": typeof lib_rls_wrappers_with_resource_rls;
  "lib/shared/schemas/utils/json_value": typeof lib_shared_schemas_utils_json_value;
  "lib/summarization/auto_summarize": typeof lib_summarization_auto_summarize;
  "lib/summarization/index": typeof lib_summarization_index;
  "lib/summarization/internal_actions": typeof lib_summarization_internal_actions;
  "lib/summarize_context": typeof lib_summarize_context;
  "lib/team_access": typeof lib_team_access;
  "lib/type_cast_helpers": typeof lib_type_cast_helpers;
  "lib/validators/common": typeof lib_validators_common;
  "lib/variables/build_context": typeof lib_variables_build_context;
  "lib/variables/evaluate_expression": typeof lib_variables_evaluate_expression;
  "lib/variables/jexl_instance": typeof lib_variables_jexl_instance;
  "lib/variables/replace_variables": typeof lib_variables_replace_variables;
  "lib/variables/replace_variables_in_string": typeof lib_variables_replace_variables_in_string;
  "lib/variables/validate_template": typeof lib_variables_validate_template;
  "members/helpers": typeof members_helpers;
  "members/internal_queries": typeof members_internal_queries;
  "members/mutations": typeof members_mutations;
  "members/queries": typeof members_queries;
  "members/types": typeof members_types;
  "members/validators": typeof members_validators;
  "message_metadata/internal_mutations": typeof message_metadata_internal_mutations;
  "message_metadata/queries": typeof message_metadata_queries;
  "migrations/backfill_workflow_schedules": typeof migrations_backfill_workflow_schedules;
  "migrations/remove_deprecated_llm_fields": typeof migrations_remove_deprecated_llm_fields;
  "migrations/trigger_steps_to_start": typeof migrations_trigger_steps_to_start;
  "node_only/documents/internal_actions": typeof node_only_documents_internal_actions;
  "node_only/integration_sandbox/execute_integration_impl": typeof node_only_integration_sandbox_execute_integration_impl;
  "node_only/integration_sandbox/helpers/base64_decode": typeof node_only_integration_sandbox_helpers_base64_decode;
  "node_only/integration_sandbox/helpers/base64_encode": typeof node_only_integration_sandbox_helpers_base64_encode;
  "node_only/integration_sandbox/helpers/create_convex_storage_provider": typeof node_only_integration_sandbox_helpers_create_convex_storage_provider;
  "node_only/integration_sandbox/helpers/create_files_api": typeof node_only_integration_sandbox_helpers_create_files_api;
  "node_only/integration_sandbox/helpers/create_http_api": typeof node_only_integration_sandbox_helpers_create_http_api;
  "node_only/integration_sandbox/helpers/create_sandbox": typeof node_only_integration_sandbox_helpers_create_sandbox;
  "node_only/integration_sandbox/helpers/create_secrets_api": typeof node_only_integration_sandbox_helpers_create_secrets_api;
  "node_only/integration_sandbox/helpers/execute_file_operation": typeof node_only_integration_sandbox_helpers_execute_file_operation;
  "node_only/integration_sandbox/helpers/execute_http_request": typeof node_only_integration_sandbox_helpers_execute_http_request;
  "node_only/integration_sandbox/helpers/index": typeof node_only_integration_sandbox_helpers_index;
  "node_only/integration_sandbox/helpers/run_with_passes": typeof node_only_integration_sandbox_helpers_run_with_passes;
  "node_only/integration_sandbox/helpers/validate_host": typeof node_only_integration_sandbox_helpers_validate_host;
  "node_only/integration_sandbox/internal_actions": typeof node_only_integration_sandbox_internal_actions;
  "node_only/integration_sandbox/types": typeof node_only_integration_sandbox_types;
  "node_only/sql/helpers/execute_mssql_query": typeof node_only_sql_helpers_execute_mssql_query;
  "node_only/sql/helpers/execute_mysql_query": typeof node_only_sql_helpers_execute_mysql_query;
  "node_only/sql/helpers/execute_postgres_query": typeof node_only_sql_helpers_execute_postgres_query;
  "node_only/sql/helpers/execute_query": typeof node_only_sql_helpers_execute_query;
  "node_only/sql/helpers/validate_query": typeof node_only_sql_helpers_validate_query;
  "node_only/sql/internal_actions": typeof node_only_sql_internal_actions;
  "node_only/sql/types": typeof node_only_sql_types;
  oauth2: typeof oauth2;
  "onedrive/actions": typeof onedrive_actions;
  "onedrive/create_sync_configs": typeof onedrive_create_sync_configs;
  "onedrive/download_and_store_file": typeof onedrive_download_and_store_file;
  "onedrive/download_file": typeof onedrive_download_file;
  "onedrive/get_file_metadata": typeof onedrive_get_file_metadata;
  "onedrive/get_user_token": typeof onedrive_get_user_token;
  "onedrive/helpers": typeof onedrive_helpers;
  "onedrive/import_files": typeof onedrive_import_files;
  "onedrive/import_files_deps": typeof onedrive_import_files_deps;
  "onedrive/internal_actions": typeof onedrive_internal_actions;
  "onedrive/internal_mutations": typeof onedrive_internal_mutations;
  "onedrive/internal_queries": typeof onedrive_internal_queries;
  "onedrive/list_files": typeof onedrive_list_files;
  "onedrive/list_folder_contents": typeof onedrive_list_folder_contents;
  "onedrive/list_sharepoint_drives": typeof onedrive_list_sharepoint_drives;
  "onedrive/list_sharepoint_files": typeof onedrive_list_sharepoint_files;
  "onedrive/list_sharepoint_sites": typeof onedrive_list_sharepoint_sites;
  "onedrive/read_file": typeof onedrive_read_file;
  "onedrive/refresh_token": typeof onedrive_refresh_token;
  "onedrive/types": typeof onedrive_types;
  "onedrive/update_sync_config": typeof onedrive_update_sync_config;
  "onedrive/upload_and_create_document": typeof onedrive_upload_and_create_document;
  "onedrive/upload_and_create_document_deps": typeof onedrive_upload_and_create_document_deps;
  "onedrive/upload_to_storage": typeof onedrive_upload_to_storage;
  "onedrive/validators": typeof onedrive_validators;
  "onedrive/with_microsoft_token": typeof onedrive_with_microsoft_token;
  "organizations/actions": typeof organizations_actions;
  "organizations/create_organization": typeof organizations_create_organization;
  "organizations/delete_organization": typeof organizations_delete_organization;
  "organizations/delete_organization_logo": typeof organizations_delete_organization_logo;
  "organizations/get_current_organization": typeof organizations_get_current_organization;
  "organizations/get_organization": typeof organizations_get_organization;
  "organizations/helpers": typeof organizations_helpers;
  "organizations/queries": typeof organizations_queries;
  "organizations/save_default_workflows": typeof organizations_save_default_workflows;
  "organizations/update_organization": typeof organizations_update_organization;
  "organizations/validators": typeof organizations_validators;
  "predefined_workflows/circuly_sync_customers": typeof predefined_workflows_circuly_sync_customers;
  "predefined_workflows/circuly_sync_products": typeof predefined_workflows_circuly_sync_products;
  "predefined_workflows/circuly_sync_subscriptions": typeof predefined_workflows_circuly_sync_subscriptions;
  "predefined_workflows/conversation_auto_archive": typeof predefined_workflows_conversation_auto_archive;
  "predefined_workflows/conversation_sync": typeof predefined_workflows_conversation_sync;
  "predefined_workflows/customer_rag_sync": typeof predefined_workflows_customer_rag_sync;
  "predefined_workflows/document_rag_sync": typeof predefined_workflows_document_rag_sync;
  "predefined_workflows/general_customer_status_assessment": typeof predefined_workflows_general_customer_status_assessment;
  "predefined_workflows/general_product_recommendation": typeof predefined_workflows_general_product_recommendation;
  "predefined_workflows/index": typeof predefined_workflows_index;
  "predefined_workflows/loopi_customer_status_assessment": typeof predefined_workflows_loopi_customer_status_assessment;
  "predefined_workflows/loopi_product_recommendation": typeof predefined_workflows_loopi_product_recommendation;
  "predefined_workflows/onedrive_sync": typeof predefined_workflows_onedrive_sync;
  "predefined_workflows/product_rag_sync": typeof predefined_workflows_product_rag_sync;
  "predefined_workflows/product_recommendation_email": typeof predefined_workflows_product_recommendation_email;
  "predefined_workflows/product_relationship_analysis": typeof predefined_workflows_product_relationship_analysis;
  "predefined_workflows/shopify_sync_customers": typeof predefined_workflows_shopify_sync_customers;
  "predefined_workflows/shopify_sync_products": typeof predefined_workflows_shopify_sync_products;
  "predefined_workflows/website_pages_rag_sync": typeof predefined_workflows_website_pages_rag_sync;
  "predefined_workflows/website_scan": typeof predefined_workflows_website_scan;
  "predefined_workflows/workflow_rag_sync": typeof predefined_workflows_workflow_rag_sync;
  "products/create_product": typeof products_create_product;
  "products/create_product_with_translations": typeof products_create_product_with_translations;
  "products/delete_product": typeof products_delete_product;
  "products/filter_products": typeof products_filter_products;
  "products/get_product": typeof products_get_product;
  "products/get_product_by_id": typeof products_get_product_by_id;
  "products/get_products_cursor": typeof products_get_products_cursor;
  "products/helpers": typeof products_helpers;
  "products/internal_mutations": typeof products_internal_mutations;
  "products/internal_queries": typeof products_internal_queries;
  "products/list_by_organization": typeof products_list_by_organization;
  "products/list_products_paginated": typeof products_list_products_paginated;
  "products/mutations": typeof products_mutations;
  "products/queries": typeof products_queries;
  "products/query_products": typeof products_query_products;
  "products/search_products_by_metadata": typeof products_search_products_by_metadata;
  "products/types": typeof products_types;
  "products/update_product": typeof products_update_product;
  "products/update_products": typeof products_update_products;
  "products/upsert_product_translation": typeof products_upsert_product_translation;
  "products/validators": typeof products_validators;
  "sso_providers/actions": typeof sso_providers_actions;
  "sso_providers/create_user_session": typeof sso_providers_create_user_session;
  "sso_providers/entra_id/adapter": typeof sso_providers_entra_id_adapter;
  "sso_providers/entra_id/constants": typeof sso_providers_entra_id_constants;
  "sso_providers/entra_id/role_mapping": typeof sso_providers_entra_id_role_mapping;
  "sso_providers/entra_id/team_sync": typeof sso_providers_entra_id_team_sync;
  "sso_providers/find_or_create_sso_user": typeof sso_providers_find_or_create_sso_user;
  "sso_providers/get": typeof sso_providers_get;
  "sso_providers/get_auth_user": typeof sso_providers_get_auth_user;
  "sso_providers/get_caller_role": typeof sso_providers_get_caller_role;
  "sso_providers/get_microsoft_token": typeof sso_providers_get_microsoft_token;
  "sso_providers/get_sso_config": typeof sso_providers_get_sso_config;
  "sso_providers/get_sso_credentials_for_email": typeof sso_providers_get_sso_credentials_for_email;
  "sso_providers/get_with_client_id": typeof sso_providers_get_with_client_id;
  "sso_providers/handle_sso_login": typeof sso_providers_handle_sso_login;
  "sso_providers/http_handlers": typeof sso_providers_http_handlers;
  "sso_providers/internal_actions": typeof sso_providers_internal_actions;
  "sso_providers/internal_mutations": typeof sso_providers_internal_mutations;
  "sso_providers/internal_queries": typeof sso_providers_internal_queries;
  "sso_providers/is_sso_configured": typeof sso_providers_is_sso_configured;
  "sso_providers/queries": typeof sso_providers_queries;
  "sso_providers/registry": typeof sso_providers_registry;
  "sso_providers/remove_provider": typeof sso_providers_remove_provider;
  "sso_providers/remove_sso_provider": typeof sso_providers_remove_sso_provider;
  "sso_providers/sign_cookie_value": typeof sso_providers_sign_cookie_value;
  "sso_providers/sso_authorize_handler": typeof sso_providers_sso_authorize_handler;
  "sso_providers/sso_callback_handler": typeof sso_providers_sso_callback_handler;
  "sso_providers/sso_discover_handler": typeof sso_providers_sso_discover_handler;
  "sso_providers/sso_set_session_handler": typeof sso_providers_sso_set_session_handler;
  "sso_providers/types": typeof sso_providers_types;
  "sso_providers/upsert_provider": typeof sso_providers_upsert_provider;
  "sso_providers/upsert_sso_provider": typeof sso_providers_upsert_sso_provider;
  "sso_providers/validate_sso_config": typeof sso_providers_validate_sso_config;
  "sso_providers/validators": typeof sso_providers_validators;
  "streaming/helpers": typeof streaming_helpers;
  "streaming/http_actions": typeof streaming_http_actions;
  "streaming/internal_mutations": typeof streaming_internal_mutations;
  "streaming/validators": typeof streaming_validators;
  "team_members/mutations": typeof team_members_mutations;
  "team_members/queries": typeof team_members_queries;
  "threads/cleanup_orphaned_sub_threads": typeof threads_cleanup_orphaned_sub_threads;
  "threads/create_chat_thread": typeof threads_create_chat_thread;
  "threads/delete_chat_thread": typeof threads_delete_chat_thread;
  "threads/get_latest_thread_with_message_count": typeof threads_get_latest_thread_with_message_count;
  "threads/get_latest_tool_message": typeof threads_get_latest_tool_message;
  "threads/get_or_create_sub_thread": typeof threads_get_or_create_sub_thread;
  "threads/get_parent_thread_id": typeof threads_get_parent_thread_id;
  "threads/get_thread_messages": typeof threads_get_thread_messages;
  "threads/get_thread_messages_streaming": typeof threads_get_thread_messages_streaming;
  "threads/helpers": typeof threads_helpers;
  "threads/internal_mutations": typeof threads_internal_mutations;
  "threads/list_threads": typeof threads_list_threads;
  "threads/mutations": typeof threads_mutations;
  "threads/queries": typeof threads_queries;
  "threads/types": typeof threads_types;
  "threads/update_chat_thread": typeof threads_update_chat_thread;
  "threads/validators": typeof threads_validators;
  "tone_of_voice/actions": typeof tone_of_voice_actions;
  "tone_of_voice/add_example_message": typeof tone_of_voice_add_example_message;
  "tone_of_voice/delete_example_message": typeof tone_of_voice_delete_example_message;
  "tone_of_voice/generate_tone_of_voice": typeof tone_of_voice_generate_tone_of_voice;
  "tone_of_voice/get_example_messages": typeof tone_of_voice_get_example_messages;
  "tone_of_voice/get_tone_of_voice": typeof tone_of_voice_get_tone_of_voice;
  "tone_of_voice/get_tone_of_voice_with_examples": typeof tone_of_voice_get_tone_of_voice_with_examples;
  "tone_of_voice/helpers": typeof tone_of_voice_helpers;
  "tone_of_voice/internal_actions": typeof tone_of_voice_internal_actions;
  "tone_of_voice/internal_mutations": typeof tone_of_voice_internal_mutations;
  "tone_of_voice/internal_queries": typeof tone_of_voice_internal_queries;
  "tone_of_voice/load_example_messages_for_generation": typeof tone_of_voice_load_example_messages_for_generation;
  "tone_of_voice/mutations": typeof tone_of_voice_mutations;
  "tone_of_voice/queries": typeof tone_of_voice_queries;
  "tone_of_voice/save_generated_tone": typeof tone_of_voice_save_generated_tone;
  "tone_of_voice/types": typeof tone_of_voice_types;
  "tone_of_voice/update_example_message": typeof tone_of_voice_update_example_message;
  "tone_of_voice/upsert_tone_of_voice": typeof tone_of_voice_upsert_tone_of_voice;
  "tone_of_voice/validators": typeof tone_of_voice_validators;
  "users/add_member_internal": typeof users_add_member_internal;
  "users/create_member": typeof users_create_member;
  "users/create_user_without_session": typeof users_create_user_without_session;
  "users/get_user_by_email": typeof users_get_user_by_email;
  "users/has_any_users": typeof users_has_any_users;
  "users/helpers": typeof users_helpers;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "users/set_member_password": typeof users_set_member_password;
  "users/types": typeof users_types;
  "users/update_user_password": typeof users_update_user_password;
  "users/validators": typeof users_validators;
  "vendors/helpers": typeof vendors_helpers;
  "vendors/list_vendors_paginated": typeof vendors_list_vendors_paginated;
  "vendors/mutations": typeof vendors_mutations;
  "vendors/queries": typeof vendors_queries;
  "vendors/validators": typeof vendors_validators;
  "websites/bulk_create_websites": typeof websites_bulk_create_websites;
  "websites/bulk_upsert_pages": typeof websites_bulk_upsert_pages;
  "websites/create_website": typeof websites_create_website;
  "websites/delete_website": typeof websites_delete_website;
  "websites/get_page_by_url": typeof websites_get_page_by_url;
  "websites/get_pages_by_website": typeof websites_get_pages_by_website;
  "websites/get_website": typeof websites_get_website;
  "websites/get_website_by_domain": typeof websites_get_website_by_domain;
  "websites/get_websites": typeof websites_get_websites;
  "websites/helpers": typeof websites_helpers;
  "websites/internal_actions": typeof websites_internal_actions;
  "websites/internal_mutations": typeof websites_internal_mutations;
  "websites/internal_queries": typeof websites_internal_queries;
  "websites/list_websites_paginated": typeof websites_list_websites_paginated;
  "websites/mutations": typeof websites_mutations;
  "websites/provision_website_scan_workflow": typeof websites_provision_website_scan_workflow;
  "websites/queries": typeof websites_queries;
  "websites/rescan_website": typeof websites_rescan_website;
  "websites/search_websites": typeof websites_search_websites;
  "websites/types": typeof websites_types;
  "websites/update_website": typeof websites_update_website;
  "websites/validators": typeof websites_validators;
  "wf_definitions/internal_mutations": typeof wf_definitions_internal_mutations;
  "wf_definitions/internal_queries": typeof wf_definitions_internal_queries;
  "wf_definitions/mutations": typeof wf_definitions_mutations;
  "wf_definitions/queries": typeof wf_definitions_queries;
  "wf_executions/internal_mutations": typeof wf_executions_internal_mutations;
  "wf_executions/internal_queries": typeof wf_executions_internal_queries;
  "wf_executions/queries": typeof wf_executions_queries;
  "wf_step_defs/actions": typeof wf_step_defs_actions;
  "wf_step_defs/audit": typeof wf_step_defs_audit;
  "wf_step_defs/internal_mutations": typeof wf_step_defs_internal_mutations;
  "wf_step_defs/internal_queries": typeof wf_step_defs_internal_queries;
  "wf_step_defs/mutations": typeof wf_step_defs_mutations;
  "wf_step_defs/queries": typeof wf_step_defs_queries;
  "workflow_engine/action_defs/action_registry": typeof workflow_engine_action_defs_action_registry;
  "workflow_engine/action_defs/approval/approval_action": typeof workflow_engine_action_defs_approval_approval_action;
  "workflow_engine/action_defs/approval/helpers/create_approval": typeof workflow_engine_action_defs_approval_helpers_create_approval;
  "workflow_engine/action_defs/approval/helpers/types": typeof workflow_engine_action_defs_approval_helpers_types;
  "workflow_engine/action_defs/conversation/conversation_action": typeof workflow_engine_action_defs_conversation_conversation_action;
  "workflow_engine/action_defs/conversation/helpers/add_message_to_conversation": typeof workflow_engine_action_defs_conversation_helpers_add_message_to_conversation;
  "workflow_engine/action_defs/conversation/helpers/build_conversation_metadata": typeof workflow_engine_action_defs_conversation_helpers_build_conversation_metadata;
  "workflow_engine/action_defs/conversation/helpers/build_email_metadata": typeof workflow_engine_action_defs_conversation_helpers_build_email_metadata;
  "workflow_engine/action_defs/conversation/helpers/build_initial_message": typeof workflow_engine_action_defs_conversation_helpers_build_initial_message;
  "workflow_engine/action_defs/conversation/helpers/check_conversation_exists": typeof workflow_engine_action_defs_conversation_helpers_check_conversation_exists;
  "workflow_engine/action_defs/conversation/helpers/check_message_exists": typeof workflow_engine_action_defs_conversation_helpers_check_message_exists;
  "workflow_engine/action_defs/conversation/helpers/create_conversation": typeof workflow_engine_action_defs_conversation_helpers_create_conversation;
  "workflow_engine/action_defs/conversation/helpers/create_conversation_from_email": typeof workflow_engine_action_defs_conversation_helpers_create_conversation_from_email;
  "workflow_engine/action_defs/conversation/helpers/create_conversation_from_sent_email": typeof workflow_engine_action_defs_conversation_helpers_create_conversation_from_sent_email;
  "workflow_engine/action_defs/conversation/helpers/find_or_create_customer_from_email": typeof workflow_engine_action_defs_conversation_helpers_find_or_create_customer_from_email;
  "workflow_engine/action_defs/conversation/helpers/find_related_conversation": typeof workflow_engine_action_defs_conversation_helpers_find_related_conversation;
  "workflow_engine/action_defs/conversation/helpers/query_conversation_messages": typeof workflow_engine_action_defs_conversation_helpers_query_conversation_messages;
  "workflow_engine/action_defs/conversation/helpers/query_latest_message_by_delivery_state": typeof workflow_engine_action_defs_conversation_helpers_query_latest_message_by_delivery_state;
  "workflow_engine/action_defs/conversation/helpers/types": typeof workflow_engine_action_defs_conversation_helpers_types;
  "workflow_engine/action_defs/conversation/helpers/update_conversations": typeof workflow_engine_action_defs_conversation_helpers_update_conversations;
  "workflow_engine/action_defs/conversation/helpers/update_message": typeof workflow_engine_action_defs_conversation_helpers_update_message;
  "workflow_engine/action_defs/crawler/crawler_action": typeof workflow_engine_action_defs_crawler_crawler_action;
  "workflow_engine/action_defs/crawler/helpers/types": typeof workflow_engine_action_defs_crawler_helpers_types;
  "workflow_engine/action_defs/customer/customer_action": typeof workflow_engine_action_defs_customer_customer_action;
  "workflow_engine/action_defs/document/document_action": typeof workflow_engine_action_defs_document_document_action;
  "workflow_engine/action_defs/integration/helpers/build_secrets_from_integration": typeof workflow_engine_action_defs_integration_helpers_build_secrets_from_integration;
  "workflow_engine/action_defs/integration/helpers/decrypt_sql_credentials": typeof workflow_engine_action_defs_integration_helpers_decrypt_sql_credentials;
  "workflow_engine/action_defs/integration/helpers/detect_write_operation": typeof workflow_engine_action_defs_integration_helpers_detect_write_operation;
  "workflow_engine/action_defs/integration/helpers/execute_sql_integration": typeof workflow_engine_action_defs_integration_helpers_execute_sql_integration;
  "workflow_engine/action_defs/integration/helpers/get_introspect_columns_query": typeof workflow_engine_action_defs_integration_helpers_get_introspect_columns_query;
  "workflow_engine/action_defs/integration/helpers/get_introspect_tables_query": typeof workflow_engine_action_defs_integration_helpers_get_introspect_tables_query;
  "workflow_engine/action_defs/integration/helpers/get_introspection_operations": typeof workflow_engine_action_defs_integration_helpers_get_introspection_operations;
  "workflow_engine/action_defs/integration/helpers/is_introspection_operation": typeof workflow_engine_action_defs_integration_helpers_is_introspection_operation;
  "workflow_engine/action_defs/integration/helpers/validate_operation_scopes": typeof workflow_engine_action_defs_integration_helpers_validate_operation_scopes;
  "workflow_engine/action_defs/integration/helpers/validate_required_parameters": typeof workflow_engine_action_defs_integration_helpers_validate_required_parameters;
  "workflow_engine/action_defs/integration/integration_action": typeof workflow_engine_action_defs_integration_integration_action;
  "workflow_engine/action_defs/onedrive/onedrive_action": typeof workflow_engine_action_defs_onedrive_onedrive_action;
  "workflow_engine/action_defs/product/product_action": typeof workflow_engine_action_defs_product_product_action;
  "workflow_engine/action_defs/rag/helpers/delete_document": typeof workflow_engine_action_defs_rag_helpers_delete_document;
  "workflow_engine/action_defs/rag/helpers/get_document_info": typeof workflow_engine_action_defs_rag_helpers_get_document_info;
  "workflow_engine/action_defs/rag/helpers/get_rag_config": typeof workflow_engine_action_defs_rag_helpers_get_rag_config;
  "workflow_engine/action_defs/rag/helpers/types": typeof workflow_engine_action_defs_rag_helpers_types;
  "workflow_engine/action_defs/rag/helpers/upload_file_direct": typeof workflow_engine_action_defs_rag_helpers_upload_file_direct;
  "workflow_engine/action_defs/rag/helpers/upload_text_document": typeof workflow_engine_action_defs_rag_helpers_upload_text_document;
  "workflow_engine/action_defs/rag/rag_action": typeof workflow_engine_action_defs_rag_rag_action;
  "workflow_engine/action_defs/set_variables_action": typeof workflow_engine_action_defs_set_variables_action;
  "workflow_engine/action_defs/tone_of_voice/tone_of_voice_action": typeof workflow_engine_action_defs_tone_of_voice_tone_of_voice_action;
  "workflow_engine/action_defs/website/helpers/types": typeof workflow_engine_action_defs_website_helpers_types;
  "workflow_engine/action_defs/website/website_action": typeof workflow_engine_action_defs_website_website_action;
  "workflow_engine/action_defs/website_pages/helpers/types": typeof workflow_engine_action_defs_website_pages_helpers_types;
  "workflow_engine/action_defs/website_pages/website_pages_action": typeof workflow_engine_action_defs_website_pages_website_pages_action;
  "workflow_engine/action_defs/workflow/helpers/types": typeof workflow_engine_action_defs_workflow_helpers_types;
  "workflow_engine/action_defs/workflow/helpers/upload_workflows": typeof workflow_engine_action_defs_workflow_helpers_upload_workflows;
  "workflow_engine/action_defs/workflow/workflow_action": typeof workflow_engine_action_defs_workflow_workflow_action;
  "workflow_engine/action_defs/workflow_processing_records/helpers/find_unprocessed": typeof workflow_engine_action_defs_workflow_processing_records_helpers_find_unprocessed;
  "workflow_engine/action_defs/workflow_processing_records/helpers/record_processed": typeof workflow_engine_action_defs_workflow_processing_records_helpers_record_processed;
  "workflow_engine/action_defs/workflow_processing_records/helpers/types": typeof workflow_engine_action_defs_workflow_processing_records_helpers_types;
  "workflow_engine/action_defs/workflow_processing_records/workflow_processing_records_action": typeof workflow_engine_action_defs_workflow_processing_records_workflow_processing_records_action;
  "workflow_engine/engine": typeof workflow_engine_engine;
  "workflow_engine/execution/dry_run_executor": typeof workflow_engine_execution_dry_run_executor;
  "workflow_engine/helpers/data_source/database_workflow_data_source": typeof workflow_engine_helpers_data_source_database_workflow_data_source;
  "workflow_engine/helpers/data_source/types": typeof workflow_engine_helpers_data_source_types;
  "workflow_engine/helpers/engine/build_steps_config_map": typeof workflow_engine_helpers_engine_build_steps_config_map;
  "workflow_engine/helpers/engine/cleanup_component_workflow": typeof workflow_engine_helpers_engine_cleanup_component_workflow;
  "workflow_engine/helpers/engine/dynamic_workflow_handler": typeof workflow_engine_helpers_engine_dynamic_workflow_handler;
  "workflow_engine/helpers/engine/execute_step_handler": typeof workflow_engine_helpers_engine_execute_step_handler;
  "workflow_engine/helpers/engine/execute_workflow_start": typeof workflow_engine_helpers_engine_execute_workflow_start;
  "workflow_engine/helpers/engine/index": typeof workflow_engine_helpers_engine_index;
  "workflow_engine/helpers/engine/load_database_workflow": typeof workflow_engine_helpers_engine_load_database_workflow;
  "workflow_engine/helpers/engine/on_workflow_complete": typeof workflow_engine_helpers_engine_on_workflow_complete;
  "workflow_engine/helpers/engine/serialize_and_complete_execution_handler": typeof workflow_engine_helpers_engine_serialize_and_complete_execution_handler;
  "workflow_engine/helpers/engine/shard": typeof workflow_engine_helpers_engine_shard;
  "workflow_engine/helpers/engine/start_workflow_handler": typeof workflow_engine_helpers_engine_start_workflow_handler;
  "workflow_engine/helpers/engine/workflow_data": typeof workflow_engine_helpers_engine_workflow_data;
  "workflow_engine/helpers/formatting/stringify": typeof workflow_engine_helpers_formatting_stringify;
  "workflow_engine/helpers/nodes/action/execute_action_node": typeof workflow_engine_helpers_nodes_action_execute_action_node;
  "workflow_engine/helpers/nodes/action/get_action": typeof workflow_engine_helpers_nodes_action_get_action;
  "workflow_engine/helpers/nodes/action/list_actions": typeof workflow_engine_helpers_nodes_action_list_actions;
  "workflow_engine/helpers/nodes/action/types": typeof workflow_engine_helpers_nodes_action_types;
  "workflow_engine/helpers/nodes/condition/execute_condition_node": typeof workflow_engine_helpers_nodes_condition_execute_condition_node;
  "workflow_engine/helpers/nodes/constants": typeof workflow_engine_helpers_nodes_constants;
  "workflow_engine/helpers/nodes/llm/execute_agent_with_tools": typeof workflow_engine_helpers_nodes_llm_execute_agent_with_tools;
  "workflow_engine/helpers/nodes/llm/execute_llm_node": typeof workflow_engine_helpers_nodes_llm_execute_llm_node;
  "workflow_engine/helpers/nodes/llm/extract_json_from_text": typeof workflow_engine_helpers_nodes_llm_extract_json_from_text;
  "workflow_engine/helpers/nodes/llm/types": typeof workflow_engine_helpers_nodes_llm_types;
  "workflow_engine/helpers/nodes/llm/types/workflow_termination": typeof workflow_engine_helpers_nodes_llm_types_workflow_termination;
  "workflow_engine/helpers/nodes/llm/utils/build_agent_steps_summary": typeof workflow_engine_helpers_nodes_llm_utils_build_agent_steps_summary;
  "workflow_engine/helpers/nodes/llm/utils/create_llm_result": typeof workflow_engine_helpers_nodes_llm_utils_create_llm_result;
  "workflow_engine/helpers/nodes/llm/utils/extract_schema_fields": typeof workflow_engine_helpers_nodes_llm_utils_extract_schema_fields;
  "workflow_engine/helpers/nodes/llm/utils/extract_tool_diagnostics": typeof workflow_engine_helpers_nodes_llm_utils_extract_tool_diagnostics;
  "workflow_engine/helpers/nodes/llm/utils/process_agent_result": typeof workflow_engine_helpers_nodes_llm_utils_process_agent_result;
  "workflow_engine/helpers/nodes/llm/utils/process_prompts": typeof workflow_engine_helpers_nodes_llm_utils_process_prompts;
  "workflow_engine/helpers/nodes/llm/utils/validate_and_normalize_config": typeof workflow_engine_helpers_nodes_llm_utils_validate_and_normalize_config;
  "workflow_engine/helpers/nodes/loop/execute_loop_node": typeof workflow_engine_helpers_nodes_loop_execute_loop_node;
  "workflow_engine/helpers/nodes/loop/loop_node_executor": typeof workflow_engine_helpers_nodes_loop_loop_node_executor;
  "workflow_engine/helpers/nodes/loop/utils/create_loop_result": typeof workflow_engine_helpers_nodes_loop_utils_create_loop_result;
  "workflow_engine/helpers/nodes/loop/utils/create_loop_state": typeof workflow_engine_helpers_nodes_loop_utils_create_loop_state;
  "workflow_engine/helpers/nodes/loop/utils/get_input_data": typeof workflow_engine_helpers_nodes_loop_utils_get_input_data;
  "workflow_engine/helpers/nodes/loop/utils/get_loop_items": typeof workflow_engine_helpers_nodes_loop_utils_get_loop_items;
  "workflow_engine/helpers/nodes/loop/utils/is_loop_in_progress": typeof workflow_engine_helpers_nodes_loop_utils_is_loop_in_progress;
  "workflow_engine/helpers/recovery/index": typeof workflow_engine_helpers_recovery_index;
  "workflow_engine/helpers/recovery/recover_stuck_executions": typeof workflow_engine_helpers_recovery_recover_stuck_executions;
  "workflow_engine/helpers/scheduler/get_last_execution_time": typeof workflow_engine_helpers_scheduler_get_last_execution_time;
  "workflow_engine/helpers/scheduler/get_scheduled_workflows": typeof workflow_engine_helpers_scheduler_get_scheduled_workflows;
  "workflow_engine/helpers/scheduler/has_running_execution": typeof workflow_engine_helpers_scheduler_has_running_execution;
  "workflow_engine/helpers/scheduler/index": typeof workflow_engine_helpers_scheduler_index;
  "workflow_engine/helpers/scheduler/scan_and_trigger": typeof workflow_engine_helpers_scheduler_scan_and_trigger;
  "workflow_engine/helpers/scheduler/should_trigger_workflow": typeof workflow_engine_helpers_scheduler_should_trigger_workflow;
  "workflow_engine/helpers/scheduler/trigger_workflow_by_id": typeof workflow_engine_helpers_scheduler_trigger_workflow_by_id;
  "workflow_engine/helpers/serialization/deserialize_variables": typeof workflow_engine_helpers_serialization_deserialize_variables;
  "workflow_engine/helpers/serialization/sanitize_depth": typeof workflow_engine_helpers_serialization_sanitize_depth;
  "workflow_engine/helpers/serialization/serialize_output": typeof workflow_engine_helpers_serialization_serialize_output;
  "workflow_engine/helpers/serialization/serialize_variables": typeof workflow_engine_helpers_serialization_serialize_variables;
  "workflow_engine/helpers/serialization/strip_transient_variables": typeof workflow_engine_helpers_serialization_strip_transient_variables;
  "workflow_engine/helpers/step_execution/build_steps_map": typeof workflow_engine_helpers_step_execution_build_steps_map;
  "workflow_engine/helpers/step_execution/decrypt_and_merge_secrets": typeof workflow_engine_helpers_step_execution_decrypt_and_merge_secrets;
  "workflow_engine/helpers/step_execution/execute_step_by_type": typeof workflow_engine_helpers_step_execution_execute_step_by_type;
  "workflow_engine/helpers/step_execution/extract_essential_loop_variables": typeof workflow_engine_helpers_step_execution_extract_essential_loop_variables;
  "workflow_engine/helpers/step_execution/extract_loop_variables": typeof workflow_engine_helpers_step_execution_extract_loop_variables;
  "workflow_engine/helpers/step_execution/extract_steps_with_outputs": typeof workflow_engine_helpers_step_execution_extract_steps_with_outputs;
  "workflow_engine/helpers/step_execution/initialize_execution_variables": typeof workflow_engine_helpers_step_execution_initialize_execution_variables;
  "workflow_engine/helpers/step_execution/load_and_validate_execution": typeof workflow_engine_helpers_step_execution_load_and_validate_execution;
  "workflow_engine/helpers/step_execution/merge_execution_variables": typeof workflow_engine_helpers_step_execution_merge_execution_variables;
  "workflow_engine/helpers/step_execution/persist_execution_result": typeof workflow_engine_helpers_step_execution_persist_execution_result;
  "workflow_engine/helpers/step_execution/types": typeof workflow_engine_helpers_step_execution_types;
  "workflow_engine/helpers/validation/circular_dependency_validator": typeof workflow_engine_helpers_validation_circular_dependency_validator;
  "workflow_engine/helpers/validation/constants": typeof workflow_engine_helpers_validation_constants;
  "workflow_engine/helpers/validation/index": typeof workflow_engine_helpers_validation_index;
  "workflow_engine/helpers/validation/steps/action": typeof workflow_engine_helpers_validation_steps_action;
  "workflow_engine/helpers/validation/steps/condition": typeof workflow_engine_helpers_validation_steps_condition;
  "workflow_engine/helpers/validation/steps/index": typeof workflow_engine_helpers_validation_steps_index;
  "workflow_engine/helpers/validation/steps/llm": typeof workflow_engine_helpers_validation_steps_llm;
  "workflow_engine/helpers/validation/steps/loop": typeof workflow_engine_helpers_validation_steps_loop;
  "workflow_engine/helpers/validation/steps/start": typeof workflow_engine_helpers_validation_steps_start;
  "workflow_engine/helpers/validation/types": typeof workflow_engine_helpers_validation_types;
  "workflow_engine/helpers/validation/validate_action_parameters": typeof workflow_engine_helpers_validation_validate_action_parameters;
  "workflow_engine/helpers/validation/validate_step_config": typeof workflow_engine_helpers_validation_validate_step_config;
  "workflow_engine/helpers/validation/validate_workflow_definition": typeof workflow_engine_helpers_validation_validate_workflow_definition;
  "workflow_engine/helpers/validation/validate_workflow_steps": typeof workflow_engine_helpers_validation_validate_workflow_steps;
  "workflow_engine/helpers/validation/variables/action_schemas": typeof workflow_engine_helpers_validation_variables_action_schemas;
  "workflow_engine/helpers/validation/variables/index": typeof workflow_engine_helpers_validation_variables_index;
  "workflow_engine/helpers/validation/variables/parse": typeof workflow_engine_helpers_validation_variables_parse;
  "workflow_engine/helpers/validation/variables/step_schemas": typeof workflow_engine_helpers_validation_variables_step_schemas;
  "workflow_engine/helpers/validation/variables/types": typeof workflow_engine_helpers_validation_variables_types;
  "workflow_engine/helpers/validation/variables/validate": typeof workflow_engine_helpers_validation_variables_validate;
  "workflow_engine/helpers/variables/decrypt_inline_secrets": typeof workflow_engine_helpers_variables_decrypt_inline_secrets;
  "workflow_engine/instructions/core_instructions": typeof workflow_engine_instructions_core_instructions;
  "workflow_engine/internal_actions": typeof workflow_engine_internal_actions;
  "workflow_engine/internal_mutations": typeof workflow_engine_internal_mutations;
  "workflow_engine/internal_queries": typeof workflow_engine_internal_queries;
  "workflow_engine/mutations": typeof workflow_engine_mutations;
  "workflow_engine/types/execution": typeof workflow_engine_types_execution;
  "workflow_engine/types/index": typeof workflow_engine_types_index;
  "workflow_engine/types/nodes": typeof workflow_engine_types_nodes;
  "workflow_engine/types/workflow": typeof workflow_engine_types_workflow;
  "workflow_engine/types/workflow_types": typeof workflow_engine_types_workflow_types;
  "workflow_engine/workflow_syntax_compact": typeof workflow_engine_workflow_syntax_compact;
  "workflows/definitions/activate_version": typeof workflows_definitions_activate_version;
  "workflows/definitions/create_draft_from_active": typeof workflows_definitions_create_draft_from_active;
  "workflows/definitions/create_workflow": typeof workflows_definitions_create_workflow;
  "workflows/definitions/create_workflow_draft": typeof workflows_definitions_create_workflow_draft;
  "workflows/definitions/create_workflow_with_steps": typeof workflows_definitions_create_workflow_with_steps;
  "workflows/definitions/delete_workflow": typeof workflows_definitions_delete_workflow;
  "workflows/definitions/duplicate_workflow": typeof workflows_definitions_duplicate_workflow;
  "workflows/definitions/get_active_version": typeof workflows_definitions_get_active_version;
  "workflows/definitions/get_automations_cursor": typeof workflows_definitions_get_automations_cursor;
  "workflows/definitions/get_draft": typeof workflows_definitions_get_draft;
  "workflows/definitions/get_version_by_number": typeof workflows_definitions_get_version_by_number;
  "workflows/definitions/get_workflow": typeof workflows_definitions_get_workflow;
  "workflows/definitions/get_workflow_by_name": typeof workflows_definitions_get_workflow_by_name;
  "workflows/definitions/get_workflow_with_first_step": typeof workflows_definitions_get_workflow_with_first_step;
  "workflows/definitions/helpers": typeof workflows_definitions_helpers;
  "workflows/definitions/list_automations": typeof workflows_definitions_list_automations;
  "workflows/definitions/list_versions": typeof workflows_definitions_list_versions;
  "workflows/definitions/list_workflows": typeof workflows_definitions_list_workflows;
  "workflows/definitions/list_workflows_with_best_version": typeof workflows_definitions_list_workflows_with_best_version;
  "workflows/definitions/publish_draft": typeof workflows_definitions_publish_draft;
  "workflows/definitions/republish_workflow": typeof workflows_definitions_republish_workflow;
  "workflows/definitions/save_manual_configuration": typeof workflows_definitions_save_manual_configuration;
  "workflows/definitions/save_workflow_with_steps": typeof workflows_definitions_save_workflow_with_steps;
  "workflows/definitions/types": typeof workflows_definitions_types;
  "workflows/definitions/unpublish_workflow": typeof workflows_definitions_unpublish_workflow;
  "workflows/definitions/update_draft": typeof workflows_definitions_update_draft;
  "workflows/definitions/update_workflow": typeof workflows_definitions_update_workflow;
  "workflows/definitions/update_workflow_status": typeof workflows_definitions_update_workflow_status;
  "workflows/definitions/validators": typeof workflows_definitions_validators;
  "workflows/executions/cleanup_execution_storage": typeof workflows_executions_cleanup_execution_storage;
  "workflows/executions/complete_execution": typeof workflows_executions_complete_execution;
  "workflows/executions/fail_execution": typeof workflows_executions_fail_execution;
  "workflows/executions/get_execution": typeof workflows_executions_get_execution;
  "workflows/executions/get_execution_step_journal": typeof workflows_executions_get_execution_step_journal;
  "workflows/executions/get_raw_execution": typeof workflows_executions_get_raw_execution;
  "workflows/executions/get_workflow_execution_stats": typeof workflows_executions_get_workflow_execution_stats;
  "workflows/executions/helpers": typeof workflows_executions_helpers;
  "workflows/executions/list_executions": typeof workflows_executions_list_executions;
  "workflows/executions/list_executions_cursor": typeof workflows_executions_list_executions_cursor;
  "workflows/executions/list_executions_paginated_native": typeof workflows_executions_list_executions_paginated_native;
  "workflows/executions/patch_execution": typeof workflows_executions_patch_execution;
  "workflows/executions/resume_execution": typeof workflows_executions_resume_execution;
  "workflows/executions/set_component_workflow": typeof workflows_executions_set_component_workflow;
  "workflows/executions/types": typeof workflows_executions_types;
  "workflows/executions/update_execution_metadata": typeof workflows_executions_update_execution_metadata;
  "workflows/executions/update_execution_status": typeof workflows_executions_update_execution_status;
  "workflows/executions/update_execution_variables": typeof workflows_executions_update_execution_variables;
  "workflows/executions/validators": typeof workflows_executions_validators;
  "workflows/helpers": typeof workflows_helpers;
  "workflows/processing_records/ast_helpers/extract_comparison": typeof workflows_processing_records_ast_helpers_extract_comparison;
  "workflows/processing_records/ast_helpers/extract_literal_value": typeof workflows_processing_records_ast_helpers_extract_literal_value;
  "workflows/processing_records/ast_helpers/get_full_field_path": typeof workflows_processing_records_ast_helpers_get_full_field_path;
  "workflows/processing_records/ast_helpers/index": typeof workflows_processing_records_ast_helpers_index;
  "workflows/processing_records/ast_helpers/is_simple_field": typeof workflows_processing_records_ast_helpers_is_simple_field;
  "workflows/processing_records/ast_helpers/merge_and_conditions": typeof workflows_processing_records_ast_helpers_merge_and_conditions;
  "workflows/processing_records/ast_helpers/traverse_ast": typeof workflows_processing_records_ast_helpers_traverse_ast;
  "workflows/processing_records/ast_helpers/types": typeof workflows_processing_records_ast_helpers_types;
  "workflows/processing_records/calculate_cutoff_timestamp": typeof workflows_processing_records_calculate_cutoff_timestamp;
  "workflows/processing_records/constants": typeof workflows_processing_records_constants;
  "workflows/processing_records/find_and_claim_unprocessed": typeof workflows_processing_records_find_and_claim_unprocessed;
  "workflows/processing_records/get_latest_processed_creation_time": typeof workflows_processing_records_get_latest_processed_creation_time;
  "workflows/processing_records/get_processing_record_by_id": typeof workflows_processing_records_get_processing_record_by_id;
  "workflows/processing_records/get_table_indexes": typeof workflows_processing_records_get_table_indexes;
  "workflows/processing_records/helpers": typeof workflows_processing_records_helpers;
  "workflows/processing_records/index_selection/group_conditions_by_field": typeof workflows_processing_records_index_selection_group_conditions_by_field;
  "workflows/processing_records/index_selection/index": typeof workflows_processing_records_index_selection_index;
  "workflows/processing_records/index_selection/score_index": typeof workflows_processing_records_index_selection_score_index;
  "workflows/processing_records/index_selection/select_optimal_index": typeof workflows_processing_records_index_selection_select_optimal_index;
  "workflows/processing_records/index_selection/types": typeof workflows_processing_records_index_selection_types;
  "workflows/processing_records/internal_mutations": typeof workflows_processing_records_internal_mutations;
  "workflows/processing_records/internal_queries": typeof workflows_processing_records_internal_queries;
  "workflows/processing_records/is_record_processed": typeof workflows_processing_records_is_record_processed;
  "workflows/processing_records/parse_filter_expression": typeof workflows_processing_records_parse_filter_expression;
  "workflows/processing_records/query_building/create_expression_filter": typeof workflows_processing_records_query_building_create_expression_filter;
  "workflows/processing_records/query_building/create_query_builder": typeof workflows_processing_records_query_building_create_query_builder;
  "workflows/processing_records/query_building/find_unprocessed": typeof workflows_processing_records_query_building_find_unprocessed;
  "workflows/processing_records/query_building/index": typeof workflows_processing_records_query_building_index;
  "workflows/processing_records/query_building/types": typeof workflows_processing_records_query_building_types;
  "workflows/processing_records/record_claimed": typeof workflows_processing_records_record_claimed;
  "workflows/processing_records/record_processed": typeof workflows_processing_records_record_processed;
  "workflows/processing_records/run_query": typeof workflows_processing_records_run_query;
  "workflows/processing_records/types": typeof workflows_processing_records_types;
  "workflows/steps/create_step": typeof workflows_steps_create_step;
  "workflows/steps/delete_step": typeof workflows_steps_delete_step;
  "workflows/steps/get_ordered_steps": typeof workflows_steps_get_ordered_steps;
  "workflows/steps/helpers": typeof workflows_steps_helpers;
  "workflows/steps/list_workflow_steps": typeof workflows_steps_list_workflow_steps;
  "workflows/steps/types": typeof workflows_steps_types;
  "workflows/steps/update_step": typeof workflows_steps_update_step;
  "workflows/steps/validators": typeof workflows_steps_validators;
  "workflows/triggers/actions": typeof workflows_triggers_actions;
  "workflows/triggers/api_http": typeof workflows_triggers_api_http;
  "workflows/triggers/emit_event": typeof workflows_triggers_emit_event;
  "workflows/triggers/event_types": typeof workflows_triggers_event_types;
  "workflows/triggers/helpers/crypto": typeof workflows_triggers_helpers_crypto;
  "workflows/triggers/helpers/validate": typeof workflows_triggers_helpers_validate;
  "workflows/triggers/http_actions": typeof workflows_triggers_http_actions;
  "workflows/triggers/internal_mutations": typeof workflows_triggers_internal_mutations;
  "workflows/triggers/internal_queries": typeof workflows_triggers_internal_queries;
  "workflows/triggers/mutations": typeof workflows_triggers_mutations;
  "workflows/triggers/process_event": typeof workflows_triggers_process_event;
  "workflows/triggers/queries": typeof workflows_triggers_queries;
  "workflows/validators": typeof workflows_validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: {
    adapter: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                data: {
                  createdAt: number;
                  email: string;
                  emailVerified: boolean;
                  image?: null | string;
                  name: string;
                  updatedAt: number;
                  userId?: null | string;
                };
                model: "user";
              }
            | {
                data: {
                  activeOrganizationId?: null | string;
                  activeTeamId?: null | string;
                  createdAt: number;
                  expiresAt: number;
                  ipAddress?: null | string;
                  token: string;
                  trustedRole?: null | string;
                  trustedTeams?: null | string;
                  updatedAt: number;
                  userAgent?: null | string;
                  userId: string;
                };
                model: "session";
              }
            | {
                data: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId: string;
                  createdAt: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt: number;
                  userId: string;
                };
                model: "account";
              }
            | {
                data: {
                  createdAt: number;
                  expiresAt: number;
                  identifier: string;
                  updatedAt: number;
                  value: string;
                };
                model: "verification";
              }
            | {
                data: {
                  createdAt: number;
                  expiresAt?: null | number;
                  privateKey: string;
                  publicKey: string;
                };
                model: "jwks";
              }
            | {
                data: {
                  createdAt: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name: string;
                  slug: string;
                };
                model: "organization";
              }
            | {
                data: {
                  createdAt: number;
                  name: string;
                  organizationId: string;
                  updatedAt?: null | number;
                };
                model: "team";
              }
            | {
                data: {
                  createdAt?: null | number;
                  teamId: string;
                  userId: string;
                };
                model: "teamMember";
              }
            | {
                data: {
                  createdAt: number;
                  organizationId: string;
                  role: string;
                  userId: string;
                };
                model: "member";
              }
            | {
                data: {
                  createdAt: number;
                  email: string;
                  expiresAt: number;
                  inviterId: string;
                  organizationId: string;
                  role?: null | string;
                  status: string;
                  teamId?: null | string;
                };
                model: "invitation";
              }
            | {
                data: {
                  createdAt: number;
                  enabled?: null | boolean;
                  expiresAt?: null | number;
                  key: string;
                  lastRefillAt?: null | number;
                  lastRequest?: null | number;
                  metadata?: null | string;
                  name?: null | string;
                  permissions?: null | string;
                  prefix?: null | string;
                  rateLimitEnabled?: null | boolean;
                  rateLimitMax?: null | number;
                  rateLimitTimeWindow?: null | number;
                  refillAmount?: null | number;
                  refillInterval?: null | number;
                  remaining?: null | number;
                  requestCount?: null | number;
                  start?: null | string;
                  updatedAt: number;
                  userId: string;
                };
                model: "apikey";
              };
          onCreateHandle?: string;
          select?: Array<string>;
        },
        any
      >;
      deleteMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "activeTeamId"
                    | "trustedRole"
                    | "trustedTeams"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "createdAt"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "team";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "organizationId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "teamMember";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "teamId" | "userId" | "createdAt" | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "teamId"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "apikey";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "start"
                    | "prefix"
                    | "key"
                    | "userId"
                    | "refillInterval"
                    | "refillAmount"
                    | "lastRefillAt"
                    | "enabled"
                    | "rateLimitEnabled"
                    | "rateLimitTimeWindow"
                    | "rateLimitMax"
                    | "requestCount"
                    | "remaining"
                    | "lastRequest"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "permissions"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any
      >;
      deleteOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "activeTeamId"
                    | "trustedRole"
                    | "trustedTeams"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "createdAt"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "team";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "organizationId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "teamMember";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "teamId" | "userId" | "createdAt" | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "teamId"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "apikey";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "start"
                    | "prefix"
                    | "key"
                    | "userId"
                    | "refillInterval"
                    | "refillAmount"
                    | "lastRefillAt"
                    | "enabled"
                    | "rateLimitEnabled"
                    | "rateLimitTimeWindow"
                    | "rateLimitMax"
                    | "requestCount"
                    | "remaining"
                    | "lastRequest"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "permissions"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
        },
        any
      >;
      findMany: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          limit?: number;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "jwks"
            | "organization"
            | "team"
            | "teamMember"
            | "member"
            | "invitation"
            | "apikey";
          offset?: number;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          sortBy?: { direction: "asc" | "desc"; field: string };
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null;
          }>;
        },
        any
      >;
      findOne: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "jwks"
            | "organization"
            | "team"
            | "teamMember"
            | "member"
            | "invitation"
            | "apikey";
          select?: Array<string>;
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null;
          }>;
        },
        any
      >;
      updateMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  createdAt?: number;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  name?: string;
                  updatedAt?: number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  activeTeamId?: null | string;
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
                  trustedRole?: null | string;
                  trustedTeams?: null | string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "activeTeamId"
                    | "trustedRole"
                    | "trustedTeams"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  createdAt?: number;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "createdAt"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "team";
                update: {
                  createdAt?: number;
                  name?: string;
                  organizationId?: string;
                  updatedAt?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "organizationId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "teamMember";
                update: {
                  createdAt?: null | number;
                  teamId?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "teamId" | "userId" | "createdAt" | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  createdAt?: number;
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                  teamId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "teamId"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "apikey";
                update: {
                  createdAt?: number;
                  enabled?: null | boolean;
                  expiresAt?: null | number;
                  key?: string;
                  lastRefillAt?: null | number;
                  lastRequest?: null | number;
                  metadata?: null | string;
                  name?: null | string;
                  permissions?: null | string;
                  prefix?: null | string;
                  rateLimitEnabled?: null | boolean;
                  rateLimitMax?: null | number;
                  rateLimitTimeWindow?: null | number;
                  refillAmount?: null | number;
                  refillInterval?: null | number;
                  remaining?: null | number;
                  requestCount?: null | number;
                  start?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "start"
                    | "prefix"
                    | "key"
                    | "userId"
                    | "refillInterval"
                    | "refillAmount"
                    | "lastRefillAt"
                    | "enabled"
                    | "rateLimitEnabled"
                    | "rateLimitTimeWindow"
                    | "rateLimitMax"
                    | "requestCount"
                    | "remaining"
                    | "lastRequest"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "permissions"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any
      >;
      updateOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  createdAt?: number;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  name?: string;
                  updatedAt?: number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  activeTeamId?: null | string;
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
                  trustedRole?: null | string;
                  trustedTeams?: null | string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "activeTeamId"
                    | "trustedRole"
                    | "trustedTeams"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  createdAt?: number;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "createdAt"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "team";
                update: {
                  createdAt?: number;
                  name?: string;
                  organizationId?: string;
                  updatedAt?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "organizationId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "teamMember";
                update: {
                  createdAt?: null | number;
                  teamId?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "teamId" | "userId" | "createdAt" | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  createdAt?: number;
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                  teamId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "teamId"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "apikey";
                update: {
                  createdAt?: number;
                  enabled?: null | boolean;
                  expiresAt?: null | number;
                  key?: string;
                  lastRefillAt?: null | number;
                  lastRequest?: null | number;
                  metadata?: null | string;
                  name?: null | string;
                  permissions?: null | string;
                  prefix?: null | string;
                  rateLimitEnabled?: null | boolean;
                  rateLimitMax?: null | number;
                  rateLimitTimeWindow?: null | number;
                  refillAmount?: null | number;
                  refillInterval?: null | number;
                  remaining?: null | number;
                  requestCount?: null | number;
                  start?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "start"
                    | "prefix"
                    | "key"
                    | "userId"
                    | "refillInterval"
                    | "refillAmount"
                    | "lastRefillAt"
                    | "enabled"
                    | "rateLimitEnabled"
                    | "rateLimitTimeWindow"
                    | "rateLimitMax"
                    | "requestCount"
                    | "remaining"
                    | "lastRequest"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "permissions"
                    | "metadata"
                    | "_id";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
        },
        any
      >;
    };
  };
  workflow: {
    event: {
      create: FunctionReference<
        "mutation",
        "internal",
        { name: string; workflowId: string },
        string
      >;
      send: FunctionReference<
        "mutation",
        "internal",
        {
          eventId?: string;
          name?: string;
          result:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId?: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        string
      >;
    };
    journal: {
      load: FunctionReference<
        "query",
        "internal",
        { shortCircuit?: boolean; workflowId: string },
        {
          blocked?: boolean;
          journalEntries: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          ok: boolean;
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      startSteps: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          steps: Array<{
            retry?:
              | boolean
              | { base: number; initialBackoffMs: number; maxAttempts: number };
            schedulerOptions?: { runAt?: number } | { runAfter?: number };
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
          }>;
          workflowId: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        Array<{
          _creationTime: number;
          _id: string;
          step:
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                functionType: "query" | "mutation" | "action";
                handle: string;
                inProgress: boolean;
                kind?: "function";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workId?: string;
              }
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                handle: string;
                inProgress: boolean;
                kind: "workflow";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workflowId?: string;
              }
            | {
                args: { eventId?: string };
                argsSize: number;
                completedAt?: number;
                eventId?: string;
                inProgress: boolean;
                kind: "event";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
              };
          stepNumber: number;
          workflowId: string;
        }>
      >;
    };
    workflow: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        null
      >;
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        boolean
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          runResult:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId: string;
        },
        null
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          maxParallelism?: number;
          onComplete?: { context?: any; fnHandle: string };
          startAsync?: boolean;
          workflowArgs: any;
          workflowHandle: string;
          workflowName: string;
        },
        string
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        {
          inProgress: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      listSteps: FunctionReference<
        "query",
        "internal",
        {
          order: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          workflowId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            args: any;
            completedAt?: number;
            eventId?: string;
            kind: "function" | "workflow" | "event";
            name: string;
            nestedWorkflowId?: string;
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt: number;
            stepId: string;
            stepNumber: number;
            workId?: string;
            workflowId: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
  };
  workflow_1: {
    event: {
      create: FunctionReference<
        "mutation",
        "internal",
        { name: string; workflowId: string },
        string
      >;
      send: FunctionReference<
        "mutation",
        "internal",
        {
          eventId?: string;
          name?: string;
          result:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId?: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        string
      >;
    };
    journal: {
      load: FunctionReference<
        "query",
        "internal",
        { shortCircuit?: boolean; workflowId: string },
        {
          blocked?: boolean;
          journalEntries: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          ok: boolean;
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      startSteps: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          steps: Array<{
            retry?:
              | boolean
              | { base: number; initialBackoffMs: number; maxAttempts: number };
            schedulerOptions?: { runAt?: number } | { runAfter?: number };
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
          }>;
          workflowId: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        Array<{
          _creationTime: number;
          _id: string;
          step:
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                functionType: "query" | "mutation" | "action";
                handle: string;
                inProgress: boolean;
                kind?: "function";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workId?: string;
              }
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                handle: string;
                inProgress: boolean;
                kind: "workflow";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workflowId?: string;
              }
            | {
                args: { eventId?: string };
                argsSize: number;
                completedAt?: number;
                eventId?: string;
                inProgress: boolean;
                kind: "event";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
              };
          stepNumber: number;
          workflowId: string;
        }>
      >;
    };
    workflow: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        null
      >;
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        boolean
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          runResult:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId: string;
        },
        null
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          maxParallelism?: number;
          onComplete?: { context?: any; fnHandle: string };
          startAsync?: boolean;
          workflowArgs: any;
          workflowHandle: string;
          workflowName: string;
        },
        string
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        {
          inProgress: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      listSteps: FunctionReference<
        "query",
        "internal",
        {
          order: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          workflowId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            args: any;
            completedAt?: number;
            eventId?: string;
            kind: "function" | "workflow" | "event";
            name: string;
            nestedWorkflowId?: string;
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt: number;
            stepId: string;
            stepNumber: number;
            workId?: string;
            workflowId: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
  };
  workflow_2: {
    event: {
      create: FunctionReference<
        "mutation",
        "internal",
        { name: string; workflowId: string },
        string
      >;
      send: FunctionReference<
        "mutation",
        "internal",
        {
          eventId?: string;
          name?: string;
          result:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId?: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        string
      >;
    };
    journal: {
      load: FunctionReference<
        "query",
        "internal",
        { shortCircuit?: boolean; workflowId: string },
        {
          blocked?: boolean;
          journalEntries: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          ok: boolean;
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      startSteps: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          steps: Array<{
            retry?:
              | boolean
              | { base: number; initialBackoffMs: number; maxAttempts: number };
            schedulerOptions?: { runAt?: number } | { runAfter?: number };
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
          }>;
          workflowId: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        Array<{
          _creationTime: number;
          _id: string;
          step:
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                functionType: "query" | "mutation" | "action";
                handle: string;
                inProgress: boolean;
                kind?: "function";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workId?: string;
              }
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                handle: string;
                inProgress: boolean;
                kind: "workflow";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workflowId?: string;
              }
            | {
                args: { eventId?: string };
                argsSize: number;
                completedAt?: number;
                eventId?: string;
                inProgress: boolean;
                kind: "event";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
              };
          stepNumber: number;
          workflowId: string;
        }>
      >;
    };
    workflow: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        null
      >;
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        boolean
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          runResult:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId: string;
        },
        null
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          maxParallelism?: number;
          onComplete?: { context?: any; fnHandle: string };
          startAsync?: boolean;
          workflowArgs: any;
          workflowHandle: string;
          workflowName: string;
        },
        string
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        {
          inProgress: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      listSteps: FunctionReference<
        "query",
        "internal",
        {
          order: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          workflowId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            args: any;
            completedAt?: number;
            eventId?: string;
            kind: "function" | "workflow" | "event";
            name: string;
            nestedWorkflowId?: string;
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt: number;
            stepId: string;
            stepNumber: number;
            workId?: string;
            workflowId: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
  };
  workflow_3: {
    event: {
      create: FunctionReference<
        "mutation",
        "internal",
        { name: string; workflowId: string },
        string
      >;
      send: FunctionReference<
        "mutation",
        "internal",
        {
          eventId?: string;
          name?: string;
          result:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId?: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        string
      >;
    };
    journal: {
      load: FunctionReference<
        "query",
        "internal",
        { shortCircuit?: boolean; workflowId: string },
        {
          blocked?: boolean;
          journalEntries: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          ok: boolean;
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      startSteps: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          steps: Array<{
            retry?:
              | boolean
              | { base: number; initialBackoffMs: number; maxAttempts: number };
            schedulerOptions?: { runAt?: number } | { runAfter?: number };
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
          }>;
          workflowId: string;
          workpoolOptions?: {
            defaultRetryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            logLevel?: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism?: number;
            retryActionsByDefault?: boolean;
          };
        },
        Array<{
          _creationTime: number;
          _id: string;
          step:
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                functionType: "query" | "mutation" | "action";
                handle: string;
                inProgress: boolean;
                kind?: "function";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workId?: string;
              }
            | {
                args: any;
                argsSize: number;
                completedAt?: number;
                handle: string;
                inProgress: boolean;
                kind: "workflow";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
                workflowId?: string;
              }
            | {
                args: { eventId?: string };
                argsSize: number;
                completedAt?: number;
                eventId?: string;
                inProgress: boolean;
                kind: "event";
                name: string;
                runResult?:
                  | { kind: "success"; returnValue: any }
                  | { error: string; kind: "failed" }
                  | { kind: "canceled" };
                startedAt: number;
              };
          stepNumber: number;
          workflowId: string;
        }>
      >;
    };
    workflow: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        null
      >;
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        boolean
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          generationNumber: number;
          runResult:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workflowId: string;
        },
        null
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          maxParallelism?: number;
          onComplete?: { context?: any; fnHandle: string };
          startAsync?: boolean;
          workflowArgs: any;
          workflowHandle: string;
          workflowName: string;
        },
        string
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        {
          inProgress: Array<{
            _creationTime: number;
            _id: string;
            step:
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  functionType: "query" | "mutation" | "action";
                  handle: string;
                  inProgress: boolean;
                  kind?: "function";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workId?: string;
                }
              | {
                  args: any;
                  argsSize: number;
                  completedAt?: number;
                  handle: string;
                  inProgress: boolean;
                  kind: "workflow";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                  workflowId?: string;
                }
              | {
                  args: { eventId?: string };
                  argsSize: number;
                  completedAt?: number;
                  eventId?: string;
                  inProgress: boolean;
                  kind: "event";
                  name: string;
                  runResult?:
                    | { kind: "success"; returnValue: any }
                    | { error: string; kind: "failed" }
                    | { kind: "canceled" };
                  startedAt: number;
                };
            stepNumber: number;
            workflowId: string;
          }>;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
          workflow: {
            _creationTime: number;
            _id: string;
            args: any;
            generationNumber: number;
            logLevel?: any;
            name?: string;
            onComplete?: { context?: any; fnHandle: string };
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt?: any;
            state?: any;
            workflowHandle: string;
          };
        }
      >;
      listSteps: FunctionReference<
        "query",
        "internal",
        {
          order: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          workflowId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            args: any;
            completedAt?: number;
            eventId?: string;
            kind: "function" | "workflow" | "event";
            name: string;
            nestedWorkflowId?: string;
            runResult?:
              | { kind: "success"; returnValue: any }
              | { error: string; kind: "failed" }
              | { kind: "canceled" };
            startedAt: number;
            stepId: string;
            stepNumber: number;
            workId?: string;
            workflowId: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
  };
  agent: {
    apiKeys: {
      destroy: FunctionReference<
        "mutation",
        "internal",
        { apiKey?: string; name?: string },
        | "missing"
        | "deleted"
        | "name mismatch"
        | "must provide either apiKey or name"
      >;
      issue: FunctionReference<
        "mutation",
        "internal",
        { name?: string },
        string
      >;
      validate: FunctionReference<
        "query",
        "internal",
        { apiKey: string },
        boolean
      >;
    };
    files: {
      addFile: FunctionReference<
        "mutation",
        "internal",
        {
          filename?: string;
          hash: string;
          mimeType: string;
          storageId: string;
        },
        { fileId: string; storageId: string }
      >;
      copyFile: FunctionReference<
        "mutation",
        "internal",
        { fileId: string },
        null
      >;
      deleteFiles: FunctionReference<
        "mutation",
        "internal",
        { fileIds: Array<string>; force?: boolean },
        Array<string>
      >;
      get: FunctionReference<
        "query",
        "internal",
        { fileId: string },
        null | {
          _creationTime: number;
          _id: string;
          filename?: string;
          hash: string;
          lastTouchedAt: number;
          mimeType: string;
          refcount: number;
          storageId: string;
        }
      >;
      getFilesToDelete: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            filename?: string;
            hash: string;
            lastTouchedAt: number;
            mimeType: string;
            refcount: number;
            storageId: string;
          }>;
        }
      >;
      useExistingFile: FunctionReference<
        "mutation",
        "internal",
        { filename?: string; hash: string },
        null | { fileId: string; storageId: string }
      >;
    };
    messages: {
      addMessages: FunctionReference<
        "mutation",
        "internal",
        {
          agentName?: string;
          embeddings?: {
            dimension:
              | 128
              | 256
              | 512
              | 768
              | 1024
              | 1408
              | 1536
              | 2048
              | 3072
              | 4096;
            model: string;
            vectors: Array<Array<number> | null>;
          };
          failPendingSteps?: boolean;
          hideFromUserIdSearch?: boolean;
          messages: Array<{
            error?: string;
            fileIds?: Array<string>;
            finishReason?:
              | "stop"
              | "length"
              | "content-filter"
              | "tool-calls"
              | "error"
              | "other"
              | "unknown";
            message:
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            image: string | ArrayBuffer;
                            mimeType?: string;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "image";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "user";
                }
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            signature?: string;
                            text: string;
                            type: "reasoning";
                          }
                        | {
                            data: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "redacted-reasoning";
                          }
                        | {
                            args: any;
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-call";
                          }
                        | {
                            args?: any;
                            experimental_content?: Array<
                              | { text: string; type: "text" }
                              | {
                                  data: string;
                                  mimeType?: string;
                                  type: "image";
                                }
                            >;
                            isError?: boolean;
                            output?:
                              | { type: "text"; value: string }
                              | { type: "json"; value: any }
                              | { type: "error-text"; value: string }
                              | { type: "error-json"; value: any }
                              | {
                                  type: "content";
                                  value: Array<
                                    | { text: string; type: "text" }
                                    | {
                                        data: string;
                                        mediaType: string;
                                        type: "media";
                                      }
                                  >;
                                };
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            result?: any;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-result";
                          }
                        | {
                            id: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "document";
                            title: string;
                            type: "source";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "assistant";
                }
              | {
                  content: Array<{
                    args?: any;
                    experimental_content?: Array<
                      | { text: string; type: "text" }
                      | { data: string; mimeType?: string; type: "image" }
                    >;
                    isError?: boolean;
                    output?:
                      | { type: "text"; value: string }
                      | { type: "json"; value: any }
                      | { type: "error-text"; value: string }
                      | { type: "error-json"; value: any }
                      | {
                          type: "content";
                          value: Array<
                            | { text: string; type: "text" }
                            | { data: string; mediaType: string; type: "media" }
                          >;
                        };
                    providerExecuted?: boolean;
                    providerMetadata?: Record<string, Record<string, any>>;
                    providerOptions?: Record<string, Record<string, any>>;
                    result?: any;
                    toolCallId: string;
                    toolName: string;
                    type: "tool-result";
                  }>;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "tool";
                }
              | {
                  content: string;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "system";
                };
            model?: string;
            provider?: string;
            providerMetadata?: Record<string, Record<string, any>>;
            reasoning?: string;
            reasoningDetails?: Array<
              | {
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  signature?: string;
                  text: string;
                  type: "reasoning";
                }
              | { signature?: string; text: string; type: "text" }
              | { data: string; type: "redacted" }
            >;
            sources?: Array<
              | {
                  id: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "url";
                  title?: string;
                  type?: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "document";
                  title: string;
                  type: "source";
                }
            >;
            status?: "pending" | "success" | "failed";
            text?: string;
            usage?: {
              cachedInputTokens?: number;
              completionTokens: number;
              promptTokens: number;
              reasoningTokens?: number;
              totalTokens: number;
            };
            warnings?: Array<
              | {
                  details?: string;
                  setting: string;
                  type: "unsupported-setting";
                }
              | { details?: string; tool: any; type: "unsupported-tool" }
              | { message: string; type: "other" }
            >;
          }>;
          pendingMessageId?: string;
          promptMessageId?: string;
          threadId: string;
          userId?: string;
        },
        {
          messages: Array<{
            _creationTime: number;
            _id: string;
            agentName?: string;
            embeddingId?: string;
            error?: string;
            fileIds?: Array<string>;
            finishReason?:
              | "stop"
              | "length"
              | "content-filter"
              | "tool-calls"
              | "error"
              | "other"
              | "unknown";
            id?: string;
            message?:
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            image: string | ArrayBuffer;
                            mimeType?: string;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "image";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "user";
                }
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            signature?: string;
                            text: string;
                            type: "reasoning";
                          }
                        | {
                            data: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "redacted-reasoning";
                          }
                        | {
                            args: any;
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-call";
                          }
                        | {
                            args?: any;
                            experimental_content?: Array<
                              | { text: string; type: "text" }
                              | {
                                  data: string;
                                  mimeType?: string;
                                  type: "image";
                                }
                            >;
                            isError?: boolean;
                            output?:
                              | { type: "text"; value: string }
                              | { type: "json"; value: any }
                              | { type: "error-text"; value: string }
                              | { type: "error-json"; value: any }
                              | {
                                  type: "content";
                                  value: Array<
                                    | { text: string; type: "text" }
                                    | {
                                        data: string;
                                        mediaType: string;
                                        type: "media";
                                      }
                                  >;
                                };
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            result?: any;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-result";
                          }
                        | {
                            id: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "document";
                            title: string;
                            type: "source";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "assistant";
                }
              | {
                  content: Array<{
                    args?: any;
                    experimental_content?: Array<
                      | { text: string; type: "text" }
                      | { data: string; mimeType?: string; type: "image" }
                    >;
                    isError?: boolean;
                    output?:
                      | { type: "text"; value: string }
                      | { type: "json"; value: any }
                      | { type: "error-text"; value: string }
                      | { type: "error-json"; value: any }
                      | {
                          type: "content";
                          value: Array<
                            | { text: string; type: "text" }
                            | { data: string; mediaType: string; type: "media" }
                          >;
                        };
                    providerExecuted?: boolean;
                    providerMetadata?: Record<string, Record<string, any>>;
                    providerOptions?: Record<string, Record<string, any>>;
                    result?: any;
                    toolCallId: string;
                    toolName: string;
                    type: "tool-result";
                  }>;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "tool";
                }
              | {
                  content: string;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "system";
                };
            model?: string;
            order: number;
            provider?: string;
            providerMetadata?: Record<string, Record<string, any>>;
            providerOptions?: Record<string, Record<string, any>>;
            reasoning?: string;
            reasoningDetails?: Array<
              | {
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  signature?: string;
                  text: string;
                  type: "reasoning";
                }
              | { signature?: string; text: string; type: "text" }
              | { data: string; type: "redacted" }
            >;
            sources?: Array<
              | {
                  id: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "url";
                  title?: string;
                  type?: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "document";
                  title: string;
                  type: "source";
                }
            >;
            status: "pending" | "success" | "failed";
            stepOrder: number;
            text?: string;
            threadId: string;
            tool: boolean;
            usage?: {
              cachedInputTokens?: number;
              completionTokens: number;
              promptTokens: number;
              reasoningTokens?: number;
              totalTokens: number;
            };
            userId?: string;
            warnings?: Array<
              | {
                  details?: string;
                  setting: string;
                  type: "unsupported-setting";
                }
              | { details?: string; tool: any; type: "unsupported-tool" }
              | { message: string; type: "other" }
            >;
          }>;
        }
      >;
      cloneThread: FunctionReference<
        "action",
        "internal",
        {
          batchSize?: number;
          copyUserIdForVectorSearch?: boolean;
          excludeToolMessages?: boolean;
          insertAtOrder?: number;
          limit?: number;
          sourceThreadId: string;
          statuses?: Array<"pending" | "success" | "failed">;
          targetThreadId: string;
          upToAndIncludingMessageId?: string;
        },
        number
      >;
      deleteByIds: FunctionReference<
        "mutation",
        "internal",
        { messageIds: Array<string> },
        Array<string>
      >;
      deleteByOrder: FunctionReference<
        "mutation",
        "internal",
        {
          endOrder: number;
          endStepOrder?: number;
          startOrder: number;
          startStepOrder?: number;
          threadId: string;
        },
        { isDone: boolean; lastOrder?: number; lastStepOrder?: number }
      >;
      finalizeMessage: FunctionReference<
        "mutation",
        "internal",
        {
          messageId: string;
          result: { status: "success" } | { error: string; status: "failed" };
        },
        null
      >;
      getMessagesByIds: FunctionReference<
        "query",
        "internal",
        { messageIds: Array<string> },
        Array<null | {
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>
      >;
      getMessageSearchFields: FunctionReference<
        "query",
        "internal",
        { messageId: string },
        { embedding?: Array<number>; embeddingModel?: string; text?: string }
      >;
      listMessagesByThreadId: FunctionReference<
        "query",
        "internal",
        {
          excludeToolMessages?: boolean;
          order: "asc" | "desc";
          paginationOpts?: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          statuses?: Array<"pending" | "success" | "failed">;
          threadId: string;
          upToAndIncludingMessageId?: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            agentName?: string;
            embeddingId?: string;
            error?: string;
            fileIds?: Array<string>;
            finishReason?:
              | "stop"
              | "length"
              | "content-filter"
              | "tool-calls"
              | "error"
              | "other"
              | "unknown";
            id?: string;
            message?:
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            image: string | ArrayBuffer;
                            mimeType?: string;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "image";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "user";
                }
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            signature?: string;
                            text: string;
                            type: "reasoning";
                          }
                        | {
                            data: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "redacted-reasoning";
                          }
                        | {
                            args: any;
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-call";
                          }
                        | {
                            args?: any;
                            experimental_content?: Array<
                              | { text: string; type: "text" }
                              | {
                                  data: string;
                                  mimeType?: string;
                                  type: "image";
                                }
                            >;
                            isError?: boolean;
                            output?:
                              | { type: "text"; value: string }
                              | { type: "json"; value: any }
                              | { type: "error-text"; value: string }
                              | { type: "error-json"; value: any }
                              | {
                                  type: "content";
                                  value: Array<
                                    | { text: string; type: "text" }
                                    | {
                                        data: string;
                                        mediaType: string;
                                        type: "media";
                                      }
                                  >;
                                };
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            result?: any;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-result";
                          }
                        | {
                            id: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "document";
                            title: string;
                            type: "source";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "assistant";
                }
              | {
                  content: Array<{
                    args?: any;
                    experimental_content?: Array<
                      | { text: string; type: "text" }
                      | { data: string; mimeType?: string; type: "image" }
                    >;
                    isError?: boolean;
                    output?:
                      | { type: "text"; value: string }
                      | { type: "json"; value: any }
                      | { type: "error-text"; value: string }
                      | { type: "error-json"; value: any }
                      | {
                          type: "content";
                          value: Array<
                            | { text: string; type: "text" }
                            | { data: string; mediaType: string; type: "media" }
                          >;
                        };
                    providerExecuted?: boolean;
                    providerMetadata?: Record<string, Record<string, any>>;
                    providerOptions?: Record<string, Record<string, any>>;
                    result?: any;
                    toolCallId: string;
                    toolName: string;
                    type: "tool-result";
                  }>;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "tool";
                }
              | {
                  content: string;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "system";
                };
            model?: string;
            order: number;
            provider?: string;
            providerMetadata?: Record<string, Record<string, any>>;
            providerOptions?: Record<string, Record<string, any>>;
            reasoning?: string;
            reasoningDetails?: Array<
              | {
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  signature?: string;
                  text: string;
                  type: "reasoning";
                }
              | { signature?: string; text: string; type: "text" }
              | { data: string; type: "redacted" }
            >;
            sources?: Array<
              | {
                  id: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "url";
                  title?: string;
                  type?: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType: string;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  sourceType: "document";
                  title: string;
                  type: "source";
                }
            >;
            status: "pending" | "success" | "failed";
            stepOrder: number;
            text?: string;
            threadId: string;
            tool: boolean;
            usage?: {
              cachedInputTokens?: number;
              completionTokens: number;
              promptTokens: number;
              reasoningTokens?: number;
              totalTokens: number;
            };
            userId?: string;
            warnings?: Array<
              | {
                  details?: string;
                  setting: string;
                  type: "unsupported-setting";
                }
              | { details?: string; tool: any; type: "unsupported-tool" }
              | { message: string; type: "other" }
            >;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      searchMessages: FunctionReference<
        "action",
        "internal",
        {
          embedding?: Array<number>;
          embeddingModel?: string;
          limit: number;
          messageRange?: { after: number; before: number };
          searchAllMessagesForUserId?: string;
          targetMessageId?: string;
          text?: string;
          textSearch?: boolean;
          threadId?: string;
          vectorScoreThreshold?: number;
          vectorSearch?: boolean;
        },
        Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>
      >;
      textSearch: FunctionReference<
        "query",
        "internal",
        {
          limit: number;
          searchAllMessagesForUserId?: string;
          targetMessageId?: string;
          text?: string;
          threadId?: string;
        },
        Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>
      >;
      updateMessage: FunctionReference<
        "mutation",
        "internal",
        {
          messageId: string;
          patch: {
            error?: string;
            fileIds?: Array<string>;
            finishReason?:
              | "stop"
              | "length"
              | "content-filter"
              | "tool-calls"
              | "error"
              | "other"
              | "unknown";
            message?:
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            image: string | ArrayBuffer;
                            mimeType?: string;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "image";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "user";
                }
              | {
                  content:
                    | string
                    | Array<
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            text: string;
                            type: "text";
                          }
                        | {
                            data: string | ArrayBuffer;
                            filename?: string;
                            mimeType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "file";
                          }
                        | {
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            signature?: string;
                            text: string;
                            type: "reasoning";
                          }
                        | {
                            data: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            type: "redacted-reasoning";
                          }
                        | {
                            args: any;
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-call";
                          }
                        | {
                            args?: any;
                            experimental_content?: Array<
                              | { text: string; type: "text" }
                              | {
                                  data: string;
                                  mimeType?: string;
                                  type: "image";
                                }
                            >;
                            isError?: boolean;
                            output?:
                              | { type: "text"; value: string }
                              | { type: "json"; value: any }
                              | { type: "error-text"; value: string }
                              | { type: "error-json"; value: any }
                              | {
                                  type: "content";
                                  value: Array<
                                    | { text: string; type: "text" }
                                    | {
                                        data: string;
                                        mediaType: string;
                                        type: "media";
                                      }
                                  >;
                                };
                            providerExecuted?: boolean;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            result?: any;
                            toolCallId: string;
                            toolName: string;
                            type: "tool-result";
                          }
                        | {
                            id: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType: string;
                            providerMetadata?: Record<
                              string,
                              Record<string, any>
                            >;
                            providerOptions?: Record<
                              string,
                              Record<string, any>
                            >;
                            sourceType: "document";
                            title: string;
                            type: "source";
                          }
                      >;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "assistant";
                }
              | {
                  content: Array<{
                    args?: any;
                    experimental_content?: Array<
                      | { text: string; type: "text" }
                      | { data: string; mimeType?: string; type: "image" }
                    >;
                    isError?: boolean;
                    output?:
                      | { type: "text"; value: string }
                      | { type: "json"; value: any }
                      | { type: "error-text"; value: string }
                      | { type: "error-json"; value: any }
                      | {
                          type: "content";
                          value: Array<
                            | { text: string; type: "text" }
                            | { data: string; mediaType: string; type: "media" }
                          >;
                        };
                    providerExecuted?: boolean;
                    providerMetadata?: Record<string, Record<string, any>>;
                    providerOptions?: Record<string, Record<string, any>>;
                    result?: any;
                    toolCallId: string;
                    toolName: string;
                    type: "tool-result";
                  }>;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "tool";
                }
              | {
                  content: string;
                  providerOptions?: Record<string, Record<string, any>>;
                  role: "system";
                };
            model?: string;
            provider?: string;
            providerOptions?: Record<string, Record<string, any>>;
            status?: "pending" | "success" | "failed";
          };
        },
        {
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }
      >;
    };
    streams: {
      abort: FunctionReference<
        "mutation",
        "internal",
        {
          finalDelta?: {
            end: number;
            parts: Array<any>;
            start: number;
            streamId: string;
          };
          reason: string;
          streamId: string;
        },
        boolean
      >;
      abortByOrder: FunctionReference<
        "mutation",
        "internal",
        { order: number; reason: string; threadId: string },
        boolean
      >;
      addDelta: FunctionReference<
        "mutation",
        "internal",
        { end: number; parts: Array<any>; start: number; streamId: string },
        boolean
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          agentName?: string;
          format?: "UIMessageChunk" | "TextStreamPart";
          model?: string;
          order: number;
          provider?: string;
          providerOptions?: Record<string, Record<string, any>>;
          stepOrder: number;
          threadId: string;
          userId?: string;
        },
        string
      >;
      deleteAllStreamsForThreadIdAsync: FunctionReference<
        "mutation",
        "internal",
        { deltaCursor?: string; streamOrder?: number; threadId: string },
        { deltaCursor?: string; isDone: boolean; streamOrder?: number }
      >;
      deleteAllStreamsForThreadIdSync: FunctionReference<
        "action",
        "internal",
        { threadId: string },
        null
      >;
      deleteStreamAsync: FunctionReference<
        "mutation",
        "internal",
        { cursor?: string; streamId: string },
        null
      >;
      deleteStreamSync: FunctionReference<
        "mutation",
        "internal",
        { streamId: string },
        null
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        {
          finalDelta?: {
            end: number;
            parts: Array<any>;
            start: number;
            streamId: string;
          };
          streamId: string;
        },
        null
      >;
      heartbeat: FunctionReference<
        "mutation",
        "internal",
        { streamId: string },
        null
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          startOrder?: number;
          statuses?: Array<"streaming" | "finished" | "aborted">;
          threadId: string;
        },
        Array<{
          agentName?: string;
          format?: "UIMessageChunk" | "TextStreamPart";
          model?: string;
          order: number;
          provider?: string;
          providerOptions?: Record<string, Record<string, any>>;
          status: "streaming" | "finished" | "aborted";
          stepOrder: number;
          streamId: string;
          userId?: string;
        }>
      >;
      listDeltas: FunctionReference<
        "query",
        "internal",
        {
          cursors: Array<{ cursor: number; streamId: string }>;
          threadId: string;
        },
        Array<{
          end: number;
          parts: Array<any>;
          start: number;
          streamId: string;
        }>
      >;
    };
    threads: {
      createThread: FunctionReference<
        "mutation",
        "internal",
        {
          defaultSystemPrompt?: string;
          parentThreadIds?: Array<string>;
          summary?: string;
          title?: string;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        }
      >;
      deleteAllForThreadIdAsync: FunctionReference<
        "mutation",
        "internal",
        {
          cursor?: string;
          deltaCursor?: string;
          limit?: number;
          messagesDone?: boolean;
          streamOrder?: number;
          streamsDone?: boolean;
          threadId: string;
        },
        { isDone: boolean }
      >;
      deleteAllForThreadIdSync: FunctionReference<
        "action",
        "internal",
        { limit?: number; threadId: string },
        null
      >;
      getThread: FunctionReference<
        "query",
        "internal",
        { threadId: string },
        {
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        } | null
      >;
      listThreadsByUserId: FunctionReference<
        "query",
        "internal",
        {
          order?: "asc" | "desc";
          paginationOpts?: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          userId?: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            status: "active" | "archived";
            summary?: string;
            title?: string;
            userId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      searchThreadTitles: FunctionReference<
        "query",
        "internal",
        { limit: number; query: string; userId?: string | null },
        Array<{
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        }>
      >;
      updateThread: FunctionReference<
        "mutation",
        "internal",
        {
          patch: {
            status?: "active" | "archived";
            summary?: string;
            title?: string;
            userId?: string;
          };
          threadId: string;
        },
        {
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        }
      >;
    };
    users: {
      deleteAllForUserId: FunctionReference<
        "action",
        "internal",
        { userId: string },
        null
      >;
      deleteAllForUserIdAsync: FunctionReference<
        "mutation",
        "internal",
        { userId: string },
        boolean
      >;
      listUsersWithThreads: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<string>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
    };
    vector: {
      index: {
        deleteBatch: FunctionReference<
          "mutation",
          "internal",
          {
            ids: Array<
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
            >;
          },
          null
        >;
        deleteBatchForThread: FunctionReference<
          "mutation",
          "internal",
          {
            cursor?: string;
            limit: number;
            model: string;
            threadId: string;
            vectorDimension:
              | 128
              | 256
              | 512
              | 768
              | 1024
              | 1408
              | 1536
              | 2048
              | 3072
              | 4096;
          },
          { continueCursor: string; isDone: boolean }
        >;
        insertBatch: FunctionReference<
          "mutation",
          "internal",
          {
            vectorDimension:
              | 128
              | 256
              | 512
              | 768
              | 1024
              | 1408
              | 1536
              | 2048
              | 3072
              | 4096;
            vectors: Array<{
              messageId?: string;
              model: string;
              table: string;
              threadId?: string;
              userId?: string;
              vector: Array<number>;
            }>;
          },
          Array<
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
          >
        >;
        paginate: FunctionReference<
          "query",
          "internal",
          {
            cursor?: string;
            limit: number;
            table?: string;
            targetModel: string;
            vectorDimension:
              | 128
              | 256
              | 512
              | 768
              | 1024
              | 1408
              | 1536
              | 2048
              | 3072
              | 4096;
          },
          {
            continueCursor: string;
            ids: Array<
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
            >;
            isDone: boolean;
          }
        >;
        updateBatch: FunctionReference<
          "mutation",
          "internal",
          {
            vectors: Array<{
              id:
                | string
                | string
                | string
                | string
                | string
                | string
                | string
                | string
                | string
                | string;
              model: string;
              vector: Array<number>;
            }>;
          },
          null
        >;
      };
    };
  };
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
  actionCache: {
    crons: {
      purge: FunctionReference<
        "mutation",
        "internal",
        { expiresAt?: number },
        null
      >;
    };
    lib: {
      get: FunctionReference<
        "query",
        "internal",
        { args: any; name: string; ttl: number | null },
        { kind: "hit"; value: any } | { expiredEntry?: string; kind: "miss" }
      >;
      put: FunctionReference<
        "mutation",
        "internal",
        {
          args: any;
          expiredEntry?: string;
          name: string;
          ttl: number | null;
          value: any;
        },
        { cacheHit: boolean; deletedExpiredEntry: boolean }
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { args: any; name: string },
        null
      >;
      removeAll: FunctionReference<
        "mutation",
        "internal",
        { batchSize?: number; before?: number; name?: string },
        null
      >;
    };
  };
  persistentTextStreaming: {
    lib: {
      addChunk: FunctionReference<
        "mutation",
        "internal",
        { final: boolean; streamId: string; text: string },
        any
      >;
      createStream: FunctionReference<"mutation", "internal", {}, any>;
      getStreamStatus: FunctionReference<
        "query",
        "internal",
        { streamId: string },
        "pending" | "streaming" | "done" | "error" | "timeout"
      >;
      getStreamText: FunctionReference<
        "query",
        "internal",
        { streamId: string },
        {
          status: "pending" | "streaming" | "done" | "error" | "timeout";
          text: string;
        }
      >;
      setStreamStatus: FunctionReference<
        "mutation",
        "internal",
        {
          status: "pending" | "streaming" | "done" | "error" | "timeout";
          streamId: string;
        },
        any
      >;
    };
  };
};
