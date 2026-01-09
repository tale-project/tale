/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as agent_tools_crawler_helpers_fetch_page_content from "../agent_tools/crawler/helpers/fetch_page_content.js";
import type * as agent_tools_crawler_helpers_fetch_searxng_results from "../agent_tools/crawler/helpers/fetch_searxng_results.js";
import type * as agent_tools_crawler_helpers_get_crawler_service_url from "../agent_tools/crawler/helpers/get_crawler_service_url.js";
import type * as agent_tools_crawler_helpers_get_search_service_url from "../agent_tools/crawler/helpers/get_search_service_url.js";
import type * as agent_tools_crawler_helpers_search_and_fetch from "../agent_tools/crawler/helpers/search_and_fetch.js";
import type * as agent_tools_crawler_helpers_search_web from "../agent_tools/crawler/helpers/search_web.js";
import type * as agent_tools_crawler_helpers_types from "../agent_tools/crawler/helpers/types.js";
import type * as agent_tools_crawler_internal_actions from "../agent_tools/crawler/internal_actions.js";
import type * as agent_tools_crawler_web_read_tool from "../agent_tools/crawler/web_read_tool.js";
import type * as agent_tools_create_json_output_tool from "../agent_tools/create_json_output_tool.js";
import type * as agent_tools_customers_customer_read_tool from "../agent_tools/customers/customer_read_tool.js";
import type * as agent_tools_customers_helpers_read_customer_by_email from "../agent_tools/customers/helpers/read_customer_by_email.js";
import type * as agent_tools_customers_helpers_read_customer_by_id from "../agent_tools/customers/helpers/read_customer_by_id.js";
import type * as agent_tools_customers_helpers_read_customer_list from "../agent_tools/customers/helpers/read_customer_list.js";
import type * as agent_tools_customers_helpers_types from "../agent_tools/customers/helpers/types.js";
import type * as agent_tools_database_database_schema_tool from "../agent_tools/database/database_schema_tool.js";
import type * as agent_tools_database_helpers_schema_definitions from "../agent_tools/database/helpers/schema_definitions.js";
import type * as agent_tools_database_helpers_types from "../agent_tools/database/helpers/types.js";
import type * as agent_tools_files_docx_tool from "../agent_tools/files/docx_tool.js";
import type * as agent_tools_files_generate_excel_tool from "../agent_tools/files/generate_excel_tool.js";
import type * as agent_tools_files_helpers_analyze_image from "../agent_tools/files/helpers/analyze_image.js";
import type * as agent_tools_files_helpers_analyze_image_by_url from "../agent_tools/files/helpers/analyze_image_by_url.js";
import type * as agent_tools_files_helpers_check_resource_accessible from "../agent_tools/files/helpers/check_resource_accessible.js";
import type * as agent_tools_files_helpers_parse_file from "../agent_tools/files/helpers/parse_file.js";
import type * as agent_tools_files_helpers_vision_agent from "../agent_tools/files/helpers/vision_agent.js";
import type * as agent_tools_files_image_tool from "../agent_tools/files/image_tool.js";
import type * as agent_tools_files_internal_actions from "../agent_tools/files/internal_actions.js";
import type * as agent_tools_files_pdf_tool from "../agent_tools/files/pdf_tool.js";
import type * as agent_tools_files_pptx_tool from "../agent_tools/files/pptx_tool.js";
import type * as agent_tools_files_resource_check_tool from "../agent_tools/files/resource_check_tool.js";
import type * as agent_tools_integrations_create_integration_approval from "../agent_tools/integrations/create_integration_approval.js";
import type * as agent_tools_integrations_execute_approved_operation from "../agent_tools/integrations/execute_approved_operation.js";
import type * as agent_tools_integrations_execute_batch_integration_internal from "../agent_tools/integrations/execute_batch_integration_internal.js";
import type * as agent_tools_integrations_execute_integration_internal from "../agent_tools/integrations/execute_integration_internal.js";
import type * as agent_tools_integrations_integration_batch_tool from "../agent_tools/integrations/integration_batch_tool.js";
import type * as agent_tools_integrations_integration_introspect_tool from "../agent_tools/integrations/integration_introspect_tool.js";
import type * as agent_tools_integrations_integration_tool from "../agent_tools/integrations/integration_tool.js";
import type * as agent_tools_integrations_types from "../agent_tools/integrations/types.js";
import type * as agent_tools_integrations_verify_approval_tool from "../agent_tools/integrations/verify_approval_tool.js";
import type * as agent_tools_load_convex_tools_as_object from "../agent_tools/load_convex_tools_as_object.js";
import type * as agent_tools_products_helpers_read_product_by_id from "../agent_tools/products/helpers/read_product_by_id.js";
import type * as agent_tools_products_helpers_read_product_list from "../agent_tools/products/helpers/read_product_list.js";
import type * as agent_tools_products_helpers_types from "../agent_tools/products/helpers/types.js";
import type * as agent_tools_products_product_read_tool from "../agent_tools/products/product_read_tool.js";
import type * as agent_tools_rag_query_rag_context from "../agent_tools/rag/query_rag_context.js";
import type * as agent_tools_rag_rag_search_tool from "../agent_tools/rag/rag_search_tool.js";
import type * as agent_tools_sub_agents_document_assistant_tool from "../agent_tools/sub_agents/document_assistant_tool.js";
import type * as agent_tools_sub_agents_helpers_format_integrations from "../agent_tools/sub_agents/helpers/format_integrations.js";
import type * as agent_tools_sub_agents_helpers_get_or_create_sub_thread from "../agent_tools/sub_agents/helpers/get_or_create_sub_thread.js";
import type * as agent_tools_sub_agents_helpers_types from "../agent_tools/sub_agents/helpers/types.js";
import type * as agent_tools_sub_agents_instructions_document_instructions from "../agent_tools/sub_agents/instructions/document_instructions.js";
import type * as agent_tools_sub_agents_instructions_integration_instructions from "../agent_tools/sub_agents/instructions/integration_instructions.js";
import type * as agent_tools_sub_agents_instructions_web_instructions from "../agent_tools/sub_agents/instructions/web_instructions.js";
import type * as agent_tools_sub_agents_integration_assistant_tool from "../agent_tools/sub_agents/integration_assistant_tool.js";
import type * as agent_tools_sub_agents_web_assistant_tool from "../agent_tools/sub_agents/web_assistant_tool.js";
import type * as agent_tools_sub_agents_workflow_assistant_tool from "../agent_tools/sub_agents/workflow_assistant_tool.js";
import type * as agent_tools_threads_context_search_tool from "../agent_tools/threads/context_search_tool.js";
import type * as agent_tools_tool_registry from "../agent_tools/tool_registry.js";
import type * as agent_tools_types from "../agent_tools/types.js";
import type * as agent_tools_workflows_create_workflow_approval from "../agent_tools/workflows/create_workflow_approval.js";
import type * as agent_tools_workflows_create_workflow_tool from "../agent_tools/workflows/create_workflow_tool.js";
import type * as agent_tools_workflows_execute_approved_workflow_creation from "../agent_tools/workflows/execute_approved_workflow_creation.js";
import type * as agent_tools_workflows_helpers_read_active_version_steps from "../agent_tools/workflows/helpers/read_active_version_steps.js";
import type * as agent_tools_workflows_helpers_read_all_workflows from "../agent_tools/workflows/helpers/read_all_workflows.js";
import type * as agent_tools_workflows_helpers_read_predefined_workflows from "../agent_tools/workflows/helpers/read_predefined_workflows.js";
import type * as agent_tools_workflows_helpers_read_version_history from "../agent_tools/workflows/helpers/read_version_history.js";
import type * as agent_tools_workflows_helpers_read_workflow_examples from "../agent_tools/workflows/helpers/read_workflow_examples.js";
import type * as agent_tools_workflows_helpers_read_workflow_structure from "../agent_tools/workflows/helpers/read_workflow_structure.js";
import type * as agent_tools_workflows_helpers_syntax_reference from "../agent_tools/workflows/helpers/syntax_reference.js";
import type * as agent_tools_workflows_helpers_types from "../agent_tools/workflows/helpers/types.js";
import type * as agent_tools_workflows_save_workflow_definition_tool from "../agent_tools/workflows/save_workflow_definition_tool.js";
import type * as agent_tools_workflows_update_workflow_step_tool from "../agent_tools/workflows/update_workflow_step_tool.js";
import type * as agent_tools_workflows_workflow_examples_tool from "../agent_tools/workflows/workflow_examples_tool.js";
import type * as agent_tools_workflows_workflow_read_tool from "../agent_tools/workflows/workflow_read_tool.js";
import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as chat_agent from "../chat_agent.js";
import type * as constants from "../constants.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as documents from "../documents.js";
import type * as email_providers from "../email_providers.js";
import type * as file from "../file.js";
import type * as http from "../http.js";
import type * as improve_message from "../improve_message.js";
import type * as integrations from "../integrations.js";
import type * as lib_action_cache_index from "../lib/action_cache/index.js";
import type * as lib_attachments_build_multi_modal_content from "../lib/attachments/build_multi_modal_content.js";
import type * as lib_attachments_format_markdown from "../lib/attachments/format_markdown.js";
import type * as lib_attachments_index from "../lib/attachments/index.js";
import type * as lib_attachments_register_files from "../lib/attachments/register_files.js";
import type * as lib_attachments_types from "../lib/attachments/types.js";
import type * as lib_create_agent_config from "../lib/create_agent_config.js";
import type * as lib_create_chat_agent from "../lib/create_chat_agent.js";
import type * as lib_create_document_agent from "../lib/create_document_agent.js";
import type * as lib_create_integration_agent from "../lib/create_integration_agent.js";
import type * as lib_create_web_agent from "../lib/create_web_agent.js";
import type * as lib_create_workflow_agent from "../lib/create_workflow_agent.js";
import type * as lib_crypto_base64_to_bytes from "../lib/crypto/base64_to_bytes.js";
import type * as lib_crypto_base64_url_to_buffer from "../lib/crypto/base64_url_to_buffer.js";
import type * as lib_crypto_decrypt_string from "../lib/crypto/decrypt_string.js";
import type * as lib_crypto_encrypt_string from "../lib/crypto/encrypt_string.js";
import type * as lib_crypto_generate_secure_state from "../lib/crypto/generate_secure_state.js";
import type * as lib_crypto_get_secret_key from "../lib/crypto/get_secret_key.js";
import type * as lib_crypto_hex_to_bytes from "../lib/crypto/hex_to_bytes.js";
import type * as lib_debug_log from "../lib/debug_log.js";
import type * as lib_error_classification from "../lib/error_classification.js";
import type * as lib_openai_provider from "../lib/openai_provider.js";
import type * as lib_pagination_helpers from "../lib/pagination/helpers.js";
import type * as lib_pagination_index from "../lib/pagination/index.js";
import type * as lib_pagination_types from "../lib/pagination/types.js";
import type * as lib_query_builder_build_query from "../lib/query_builder/build_query.js";
import type * as lib_query_builder_index from "../lib/query_builder/index.js";
import type * as lib_query_builder_select_index from "../lib/query_builder/select_index.js";
import type * as lib_query_builder_types from "../lib/query_builder/types.js";
import type * as lib_rate_limiter_helpers from "../lib/rate_limiter/helpers.js";
import type * as lib_rate_limiter_index from "../lib/rate_limiter/index.js";
import type * as lib_rls_auth_get_authenticated_user from "../lib/rls/auth/get_authenticated_user.js";
import type * as lib_rls_auth_require_authenticated_user from "../lib/rls/auth/require_authenticated_user.js";
import type * as lib_rls_context_create_org_query_builder from "../lib/rls/context/create_org_query_builder.js";
import type * as lib_rls_context_create_rls_context from "../lib/rls/context/create_rls_context.js";
import type * as lib_rls_errors from "../lib/rls/errors.js";
import type * as lib_rls_helpers_mutation_with_rls from "../lib/rls/helpers/mutation_with_rls.js";
import type * as lib_rls_helpers_query_with_rls from "../lib/rls/helpers/query_with_rls.js";
import type * as lib_rls_helpers_rls_rules from "../lib/rls/helpers/rls_rules.js";
import type * as lib_rls_index from "../lib/rls/index.js";
import type * as lib_rls_organization_get_organization_member from "../lib/rls/organization/get_organization_member.js";
import type * as lib_rls_organization_get_user_organizations from "../lib/rls/organization/get_user_organizations.js";
import type * as lib_rls_organization_validate_organization_access from "../lib/rls/organization/validate_organization_access.js";
import type * as lib_rls_organization_validate_resource_organization from "../lib/rls/organization/validate_resource_organization.js";
import type * as lib_rls_types from "../lib/rls/types.js";
import type * as lib_rls_validators from "../lib/rls/validators.js";
import type * as lib_rls_wrappers_with_organization_rls from "../lib/rls/wrappers/with_organization_rls.js";
import type * as lib_rls_wrappers_with_resource_rls from "../lib/rls/wrappers/with_resource_rls.js";
import type * as lib_summarize_context from "../lib/summarize_context.js";
import type * as lib_variables_build_context from "../lib/variables/build_context.js";
import type * as lib_variables_evaluate_expression from "../lib/variables/evaluate_expression.js";
import type * as lib_variables_jexl_instance from "../lib/variables/jexl_instance.js";
import type * as lib_variables_replace_variables from "../lib/variables/replace_variables.js";
import type * as lib_variables_replace_variables_in_string from "../lib/variables/replace_variables_in_string.js";
import type * as lib_variables_validate_template from "../lib/variables/validate_template.js";
import type * as member from "../member.js";
import type * as message_metadata from "../message_metadata.js";
import type * as model_accounts_index from "../model/accounts/index.js";
import type * as model_accounts_microsoft_get_microsoft_account from "../model/accounts/microsoft/get_microsoft_account.js";
import type * as model_accounts_microsoft_get_microsoft_account_by_user_id from "../model/accounts/microsoft/get_microsoft_account_by_user_id.js";
import type * as model_accounts_microsoft_has_microsoft_account from "../model/accounts/microsoft/has_microsoft_account.js";
import type * as model_accounts_microsoft_index from "../model/accounts/microsoft/index.js";
import type * as model_accounts_microsoft_update_microsoft_tokens from "../model/accounts/microsoft/update_microsoft_tokens.js";
import type * as model_approvals_create_approval from "../model/approvals/create_approval.js";
import type * as model_approvals_get_approval from "../model/approvals/get_approval.js";
import type * as model_approvals_get_approval_history from "../model/approvals/get_approval_history.js";
import type * as model_approvals_index from "../model/approvals/index.js";
import type * as model_approvals_link_approvals_to_message from "../model/approvals/link_approvals_to_message.js";
import type * as model_approvals_list_approvals_by_organization from "../model/approvals/list_approvals_by_organization.js";
import type * as model_approvals_list_approvals_for_execution from "../model/approvals/list_approvals_for_execution.js";
import type * as model_approvals_list_pending_approvals from "../model/approvals/list_pending_approvals.js";
import type * as model_approvals_list_pending_approvals_for_execution from "../model/approvals/list_pending_approvals_for_execution.js";
import type * as model_approvals_remove_recommended_product from "../model/approvals/remove_recommended_product.js";
import type * as model_approvals_types from "../model/approvals/types.js";
import type * as model_approvals_update_approval_status from "../model/approvals/update_approval_status.js";
import type * as model_approvals_validators from "../model/approvals/validators.js";
import type * as model_chat_agent_auto_summarize_if_needed from "../model/chat_agent/auto_summarize_if_needed.js";
import type * as model_chat_agent_chat_with_agent from "../model/chat_agent/chat_with_agent.js";
import type * as model_chat_agent_context_management_check_and_summarize from "../model/chat_agent/context_management/check_and_summarize.js";
import type * as model_chat_agent_context_management_constants from "../model/chat_agent/context_management/constants.js";
import type * as model_chat_agent_context_management_context_handler from "../model/chat_agent/context_management/context_handler.js";
import type * as model_chat_agent_context_management_context_priority from "../model/chat_agent/context_management/context_priority.js";
import type * as model_chat_agent_context_management_estimate_context_size from "../model/chat_agent/context_management/estimate_context_size.js";
import type * as model_chat_agent_context_management_estimate_tokens from "../model/chat_agent/context_management/estimate_tokens.js";
import type * as model_chat_agent_context_management_index from "../model/chat_agent/context_management/index.js";
import type * as model_chat_agent_generate_agent_response from "../model/chat_agent/generate_agent_response.js";
import type * as model_chat_agent_index from "../model/chat_agent/index.js";
import type * as model_chat_agent_message_deduplication from "../model/chat_agent/message_deduplication.js";
import type * as model_chat_agent_on_chat_complete from "../model/chat_agent/on_chat_complete.js";
import type * as model_common_validators from "../model/common/validators.js";
import type * as model_conversations_add_message_to_conversation from "../model/conversations/add_message_to_conversation.js";
import type * as model_conversations_bulk_close_conversations from "../model/conversations/bulk_close_conversations.js";
import type * as model_conversations_bulk_reopen_conversations from "../model/conversations/bulk_reopen_conversations.js";
import type * as model_conversations_close_conversation from "../model/conversations/close_conversation.js";
import type * as model_conversations_create_conversation from "../model/conversations/create_conversation.js";
import type * as model_conversations_create_conversation_public from "../model/conversations/create_conversation_public.js";
import type * as model_conversations_create_conversation_with_message from "../model/conversations/create_conversation_with_message.js";
import type * as model_conversations_delete_conversation from "../model/conversations/delete_conversation.js";
import type * as model_conversations_get_conversation_by_external_message_id from "../model/conversations/get_conversation_by_external_message_id.js";
import type * as model_conversations_get_conversation_by_id from "../model/conversations/get_conversation_by_id.js";
import type * as model_conversations_get_conversation_with_messages from "../model/conversations/get_conversation_with_messages.js";
import type * as model_conversations_get_conversations from "../model/conversations/get_conversations.js";
import type * as model_conversations_get_conversations_page from "../model/conversations/get_conversations_page.js";
import type * as model_conversations_get_message_by_external_id from "../model/conversations/get_message_by_external_id.js";
import type * as model_conversations_index from "../model/conversations/index.js";
import type * as model_conversations_mark_conversation_as_read from "../model/conversations/mark_conversation_as_read.js";
import type * as model_conversations_mark_conversation_as_spam from "../model/conversations/mark_conversation_as_spam.js";
import type * as model_conversations_query_conversation_messages from "../model/conversations/query_conversation_messages.js";
import type * as model_conversations_query_conversations from "../model/conversations/query_conversations.js";
import type * as model_conversations_query_latest_message_by_delivery_state from "../model/conversations/query_latest_message_by_delivery_state.js";
import type * as model_conversations_reopen_conversation from "../model/conversations/reopen_conversation.js";
import type * as model_conversations_send_message_via_email from "../model/conversations/send_message_via_email.js";
import type * as model_conversations_transform_conversation from "../model/conversations/transform_conversation.js";
import type * as model_conversations_types from "../model/conversations/types.js";
import type * as model_conversations_update_conversation from "../model/conversations/update_conversation.js";
import type * as model_conversations_update_conversation_message from "../model/conversations/update_conversation_message.js";
import type * as model_conversations_update_conversations from "../model/conversations/update_conversations.js";
import type * as model_conversations_validators from "../model/conversations/validators.js";
import type * as model_customers_bulk_create_customers from "../model/customers/bulk_create_customers.js";
import type * as model_customers_create_customer from "../model/customers/create_customer.js";
import type * as model_customers_create_customer_public from "../model/customers/create_customer_public.js";
import type * as model_customers_delete_customer from "../model/customers/delete_customer.js";
import type * as model_customers_filter_customers from "../model/customers/filter_customers.js";
import type * as model_customers_find_or_create_customer from "../model/customers/find_or_create_customer.js";
import type * as model_customers_get_customer from "../model/customers/get_customer.js";
import type * as model_customers_get_customer_by_email from "../model/customers/get_customer_by_email.js";
import type * as model_customers_get_customer_by_external_id from "../model/customers/get_customer_by_external_id.js";
import type * as model_customers_get_customer_by_id from "../model/customers/get_customer_by_id.js";
import type * as model_customers_get_customers from "../model/customers/get_customers.js";
import type * as model_customers_index from "../model/customers/index.js";
import type * as model_customers_query_customers from "../model/customers/query_customers.js";
import type * as model_customers_search_customers from "../model/customers/search_customers.js";
import type * as model_customers_types from "../model/customers/types.js";
import type * as model_customers_update_customer from "../model/customers/update_customer.js";
import type * as model_customers_update_customer_metadata from "../model/customers/update_customer_metadata.js";
import type * as model_customers_update_customers from "../model/customers/update_customers.js";
import type * as model_customers_validators from "../model/customers/validators.js";
import type * as model_documents_check_membership from "../model/documents/check_membership.js";
import type * as model_documents_create_document from "../model/documents/create_document.js";
import type * as model_documents_create_onedrive_sync_config from "../model/documents/create_onedrive_sync_config.js";
import type * as model_documents_delete_document from "../model/documents/delete_document.js";
import type * as model_documents_extract_extension from "../model/documents/extract_extension.js";
import type * as model_documents_find_document_by_title from "../model/documents/find_document_by_title.js";
import type * as model_documents_generate_document from "../model/documents/generate_document.js";
import type * as model_documents_generate_document_helpers from "../model/documents/generate_document_helpers.js";
import type * as model_documents_generate_docx from "../model/documents/generate_docx.js";
import type * as model_documents_generate_docx_from_template from "../model/documents/generate_docx_from_template.js";
import type * as model_documents_generate_pptx from "../model/documents/generate_pptx.js";
import type * as model_documents_generate_signed_url from "../model/documents/generate_signed_url.js";
import type * as model_documents_get_document_by_id from "../model/documents/get_document_by_id.js";
import type * as model_documents_get_document_by_id_public from "../model/documents/get_document_by_id_public.js";
import type * as model_documents_get_document_by_path from "../model/documents/get_document_by_path.js";
import type * as model_documents_get_documents from "../model/documents/get_documents.js";
import type * as model_documents_get_documents_cursor from "../model/documents/get_documents_cursor.js";
import type * as model_documents_get_onedrive_sync_configs from "../model/documents/get_onedrive_sync_configs.js";
import type * as model_documents_index from "../model/documents/index.js";
import type * as model_documents_list_documents_by_extension from "../model/documents/list_documents_by_extension.js";
import type * as model_documents_query_documents from "../model/documents/query_documents.js";
import type * as model_documents_read_file_base64_from_storage from "../model/documents/read_file_base64_from_storage.js";
import type * as model_documents_transform_to_document_item from "../model/documents/transform_to_document_item.js";
import type * as model_documents_types from "../model/documents/types.js";
import type * as model_documents_update_document from "../model/documents/update_document.js";
import type * as model_documents_upload_base64_to_storage from "../model/documents/upload_base64_to_storage.js";
import type * as model_documents_validators from "../model/documents/validators.js";
import type * as model_email_providers_create_oauth2_provider_logic from "../model/email_providers/create_oauth2_provider_logic.js";
import type * as model_email_providers_create_provider_internal from "../model/email_providers/create_provider_internal.js";
import type * as model_email_providers_create_provider_logic from "../model/email_providers/create_provider_logic.js";
import type * as model_email_providers_decrypt_and_refresh_oauth2 from "../model/email_providers/decrypt_and_refresh_oauth2.js";
import type * as model_email_providers_delete_provider from "../model/email_providers/delete_provider.js";
import type * as model_email_providers_generate_oauth2_auth_url from "../model/email_providers/generate_oauth2_auth_url.js";
import type * as model_email_providers_generate_oauth2_auth_url_logic from "../model/email_providers/generate_oauth2_auth_url_logic.js";
import type * as model_email_providers_get_default_provider from "../model/email_providers/get_default_provider.js";
import type * as model_email_providers_get_provider_by_id from "../model/email_providers/get_provider_by_id.js";
import type * as model_email_providers_index from "../model/email_providers/index.js";
import type * as model_email_providers_list_providers from "../model/email_providers/list_providers.js";
import type * as model_email_providers_save_related_workflows from "../model/email_providers/save_related_workflows.js";
import type * as model_email_providers_send_message_via_api from "../model/email_providers/send_message_via_api.js";
import type * as model_email_providers_send_message_via_smtp from "../model/email_providers/send_message_via_smtp.js";
import type * as model_email_providers_store_oauth2_tokens_logic from "../model/email_providers/store_oauth2_tokens_logic.js";
import type * as model_email_providers_test_connection_types from "../model/email_providers/test_connection_types.js";
import type * as model_email_providers_test_existing_provider from "../model/email_providers/test_existing_provider.js";
import type * as model_email_providers_test_existing_provider_logic from "../model/email_providers/test_existing_provider_logic.js";
import type * as model_email_providers_test_imap_connection_logic from "../model/email_providers/test_imap_connection_logic.js";
import type * as model_email_providers_test_new_provider_connection_logic from "../model/email_providers/test_new_provider_connection_logic.js";
import type * as model_email_providers_test_smtp_connection_logic from "../model/email_providers/test_smtp_connection_logic.js";
import type * as model_email_providers_types from "../model/email_providers/types.js";
import type * as model_email_providers_update_metadata_internal from "../model/email_providers/update_metadata_internal.js";
import type * as model_email_providers_update_oauth2_tokens from "../model/email_providers/update_oauth2_tokens.js";
import type * as model_email_providers_update_provider from "../model/email_providers/update_provider.js";
import type * as model_email_providers_update_provider_status from "../model/email_providers/update_provider_status.js";
import type * as model_email_providers_validators from "../model/email_providers/validators.js";
import type * as model_integrations_create_integration_internal from "../model/integrations/create_integration_internal.js";
import type * as model_integrations_create_integration_logic from "../model/integrations/create_integration_logic.js";
import type * as model_integrations_delete_integration from "../model/integrations/delete_integration.js";
import type * as model_integrations_encrypt_credentials from "../model/integrations/encrypt_credentials.js";
import type * as model_integrations_get_decrypted_credentials from "../model/integrations/get_decrypted_credentials.js";
import type * as model_integrations_get_integration from "../model/integrations/get_integration.js";
import type * as model_integrations_get_integration_by_name from "../model/integrations/get_integration_by_name.js";
import type * as model_integrations_get_workflows_for_integration from "../model/integrations/get_workflows_for_integration.js";
import type * as model_integrations_guards_is_rest_api_integration from "../model/integrations/guards/is_rest_api_integration.js";
import type * as model_integrations_guards_is_sql_integration from "../model/integrations/guards/is_sql_integration.js";
import type * as model_integrations_index from "../model/integrations/index.js";
import type * as model_integrations_list_integrations from "../model/integrations/list_integrations.js";
import type * as model_integrations_run_health_check from "../model/integrations/run_health_check.js";
import type * as model_integrations_save_related_workflows from "../model/integrations/save_related_workflows.js";
import type * as model_integrations_test_circuly_connection from "../model/integrations/test_circuly_connection.js";
import type * as model_integrations_test_connection_logic from "../model/integrations/test_connection_logic.js";
import type * as model_integrations_test_shopify_connection from "../model/integrations/test_shopify_connection.js";
import type * as model_integrations_types from "../model/integrations/types.js";
import type * as model_integrations_update_integration_internal from "../model/integrations/update_integration_internal.js";
import type * as model_integrations_update_integration_logic from "../model/integrations/update_integration_logic.js";
import type * as model_integrations_update_sync_stats from "../model/integrations/update_sync_stats.js";
import type * as model_integrations_utils_get_integration_type from "../model/integrations/utils/get_integration_type.js";
import type * as model_integrations_validators from "../model/integrations/validators.js";
import type * as model_members_index from "../model/members/index.js";
import type * as model_members_types from "../model/members/types.js";
import type * as model_members_validators from "../model/members/validators.js";
import type * as model_onedrive_create_sync_configs_logic from "../model/onedrive/create_sync_configs_logic.js";
import type * as model_onedrive_get_user_token_logic from "../model/onedrive/get_user_token_logic.js";
import type * as model_onedrive_index from "../model/onedrive/index.js";
import type * as model_onedrive_list_folder_contents_logic from "../model/onedrive/list_folder_contents_logic.js";
import type * as model_onedrive_read_file_logic from "../model/onedrive/read_file_logic.js";
import type * as model_onedrive_refresh_token_logic from "../model/onedrive/refresh_token_logic.js";
import type * as model_onedrive_update_sync_config_logic from "../model/onedrive/update_sync_config_logic.js";
import type * as model_onedrive_upload_and_create_document_logic from "../model/onedrive/upload_and_create_document_logic.js";
import type * as model_onedrive_upload_to_storage_logic from "../model/onedrive/upload_to_storage_logic.js";
import type * as model_onedrive_validators from "../model/onedrive/validators.js";
import type * as model_organizations_create_organization from "../model/organizations/create_organization.js";
import type * as model_organizations_delete_organization from "../model/organizations/delete_organization.js";
import type * as model_organizations_delete_organization_logo from "../model/organizations/delete_organization_logo.js";
import type * as model_organizations_get_current_organization from "../model/organizations/get_current_organization.js";
import type * as model_organizations_get_organization from "../model/organizations/get_organization.js";
import type * as model_organizations_index from "../model/organizations/index.js";
import type * as model_organizations_save_default_workflows from "../model/organizations/save_default_workflows.js";
import type * as model_organizations_types from "../model/organizations/types.js";
import type * as model_organizations_update_organization from "../model/organizations/update_organization.js";
import type * as model_organizations_validators from "../model/organizations/validators.js";
import type * as model_products_create_product from "../model/products/create_product.js";
import type * as model_products_create_product_public from "../model/products/create_product_public.js";
import type * as model_products_delete_product from "../model/products/delete_product.js";
import type * as model_products_filter_products from "../model/products/filter_products.js";
import type * as model_products_get_product from "../model/products/get_product.js";
import type * as model_products_get_product_by_id from "../model/products/get_product_by_id.js";
import type * as model_products_get_products from "../model/products/get_products.js";
import type * as model_products_get_products_cursor from "../model/products/get_products_cursor.js";
import type * as model_products_index from "../model/products/index.js";
import type * as model_products_list_by_organization from "../model/products/list_by_organization.js";
import type * as model_products_query_products from "../model/products/query_products.js";
import type * as model_products_search_products_by_metadata from "../model/products/search_products_by_metadata.js";
import type * as model_products_types from "../model/products/types.js";
import type * as model_products_update_product from "../model/products/update_product.js";
import type * as model_products_update_products from "../model/products/update_products.js";
import type * as model_products_upsert_product_translation from "../model/products/upsert_product_translation.js";
import type * as model_products_validators from "../model/products/validators.js";
import type * as model_threads_create_chat_thread from "../model/threads/create_chat_thread.js";
import type * as model_threads_delete_chat_thread from "../model/threads/delete_chat_thread.js";
import type * as model_threads_get_latest_thread_with_message_count from "../model/threads/get_latest_thread_with_message_count.js";
import type * as model_threads_get_latest_tool_message from "../model/threads/get_latest_tool_message.js";
import type * as model_threads_get_or_create_sub_thread from "../model/threads/get_or_create_sub_thread.js";
import type * as model_threads_get_thread_messages from "../model/threads/get_thread_messages.js";
import type * as model_threads_get_thread_messages_streaming from "../model/threads/get_thread_messages_streaming.js";
import type * as model_threads_index from "../model/threads/index.js";
import type * as model_threads_list_threads from "../model/threads/list_threads.js";
import type * as model_threads_update_chat_thread from "../model/threads/update_chat_thread.js";
import type * as model_threads_validators from "../model/threads/validators.js";
import type * as model_tone_of_voice_add_example_message from "../model/tone_of_voice/add_example_message.js";
import type * as model_tone_of_voice_delete_example_message from "../model/tone_of_voice/delete_example_message.js";
import type * as model_tone_of_voice_generate_tone_of_voice from "../model/tone_of_voice/generate_tone_of_voice.js";
import type * as model_tone_of_voice_get_example_messages from "../model/tone_of_voice/get_example_messages.js";
import type * as model_tone_of_voice_get_tone_of_voice from "../model/tone_of_voice/get_tone_of_voice.js";
import type * as model_tone_of_voice_get_tone_of_voice_with_examples from "../model/tone_of_voice/get_tone_of_voice_with_examples.js";
import type * as model_tone_of_voice_has_example_messages from "../model/tone_of_voice/has_example_messages.js";
import type * as model_tone_of_voice_index from "../model/tone_of_voice/index.js";
import type * as model_tone_of_voice_load_example_messages_for_generation from "../model/tone_of_voice/load_example_messages_for_generation.js";
import type * as model_tone_of_voice_regenerate_tone_of_voice from "../model/tone_of_voice/regenerate_tone_of_voice.js";
import type * as model_tone_of_voice_save_generated_tone from "../model/tone_of_voice/save_generated_tone.js";
import type * as model_tone_of_voice_types from "../model/tone_of_voice/types.js";
import type * as model_tone_of_voice_update_example_message from "../model/tone_of_voice/update_example_message.js";
import type * as model_tone_of_voice_upsert_tone_of_voice from "../model/tone_of_voice/upsert_tone_of_voice.js";
import type * as model_tone_of_voice_validators from "../model/tone_of_voice/validators.js";
import type * as model_trusted_headers_authenticate_create_session_for_trusted_user from "../model/trusted_headers_authenticate/create_session_for_trusted_user.js";
import type * as model_trusted_headers_authenticate_find_or_create_user_from_headers from "../model/trusted_headers_authenticate/find_or_create_user_from_headers.js";
import type * as model_trusted_headers_authenticate_get_user_by_id from "../model/trusted_headers_authenticate/get_user_by_id.js";
import type * as model_trusted_headers_authenticate_index from "../model/trusted_headers_authenticate/index.js";
import type * as model_trusted_headers_authenticate_trusted_headers_authenticate from "../model/trusted_headers_authenticate/trusted_headers_authenticate.js";
import type * as model_users_add_member_internal from "../model/users/add_member_internal.js";
import type * as model_users_create_member from "../model/users/create_member.js";
import type * as model_users_create_user_without_session from "../model/users/create_user_without_session.js";
import type * as model_users_get_user_by_email from "../model/users/get_user_by_email.js";
import type * as model_users_has_any_users from "../model/users/has_any_users.js";
import type * as model_users_index from "../model/users/index.js";
import type * as model_users_update_user_password from "../model/users/update_user_password.js";
import type * as model_vendors_index from "../model/vendors/index.js";
import type * as model_vendors_validators from "../model/vendors/validators.js";
import type * as model_websites_bulk_create_websites from "../model/websites/bulk_create_websites.js";
import type * as model_websites_bulk_upsert_pages from "../model/websites/bulk_upsert_pages.js";
import type * as model_websites_create_website from "../model/websites/create_website.js";
import type * as model_websites_delete_website from "../model/websites/delete_website.js";
import type * as model_websites_get_page_by_url from "../model/websites/get_page_by_url.js";
import type * as model_websites_get_pages_by_website from "../model/websites/get_pages_by_website.js";
import type * as model_websites_get_website from "../model/websites/get_website.js";
import type * as model_websites_get_website_by_domain from "../model/websites/get_website_by_domain.js";
import type * as model_websites_get_websites from "../model/websites/get_websites.js";
import type * as model_websites_index from "../model/websites/index.js";
import type * as model_websites_provision_website_scan_workflow from "../model/websites/provision_website_scan_workflow.js";
import type * as model_websites_rescan_website from "../model/websites/rescan_website.js";
import type * as model_websites_search_websites from "../model/websites/search_websites.js";
import type * as model_websites_types from "../model/websites/types.js";
import type * as model_websites_update_website from "../model/websites/update_website.js";
import type * as model_websites_validators from "../model/websites/validators.js";
import type * as model_wf_definitions_activate_version from "../model/wf_definitions/activate_version.js";
import type * as model_wf_definitions_create_draft_from_active from "../model/wf_definitions/create_draft_from_active.js";
import type * as model_wf_definitions_create_workflow from "../model/wf_definitions/create_workflow.js";
import type * as model_wf_definitions_create_workflow_draft from "../model/wf_definitions/create_workflow_draft.js";
import type * as model_wf_definitions_create_workflow_with_steps from "../model/wf_definitions/create_workflow_with_steps.js";
import type * as model_wf_definitions_delete_workflow from "../model/wf_definitions/delete_workflow.js";
import type * as model_wf_definitions_duplicate_workflow from "../model/wf_definitions/duplicate_workflow.js";
import type * as model_wf_definitions_get_active_version from "../model/wf_definitions/get_active_version.js";
import type * as model_wf_definitions_get_automations_cursor from "../model/wf_definitions/get_automations_cursor.js";
import type * as model_wf_definitions_get_draft from "../model/wf_definitions/get_draft.js";
import type * as model_wf_definitions_get_version_by_number from "../model/wf_definitions/get_version_by_number.js";
import type * as model_wf_definitions_get_workflow from "../model/wf_definitions/get_workflow.js";
import type * as model_wf_definitions_get_workflow_by_name from "../model/wf_definitions/get_workflow_by_name.js";
import type * as model_wf_definitions_get_workflow_with_first_step from "../model/wf_definitions/get_workflow_with_first_step.js";
import type * as model_wf_definitions_index from "../model/wf_definitions/index.js";
import type * as model_wf_definitions_list_versions from "../model/wf_definitions/list_versions.js";
import type * as model_wf_definitions_list_workflows from "../model/wf_definitions/list_workflows.js";
import type * as model_wf_definitions_list_workflows_with_best_version from "../model/wf_definitions/list_workflows_with_best_version.js";
import type * as model_wf_definitions_publish_draft from "../model/wf_definitions/publish_draft.js";
import type * as model_wf_definitions_save_manual_configuration from "../model/wf_definitions/save_manual_configuration.js";
import type * as model_wf_definitions_save_workflow_with_steps from "../model/wf_definitions/save_workflow_with_steps.js";
import type * as model_wf_definitions_types from "../model/wf_definitions/types.js";
import type * as model_wf_definitions_update_draft from "../model/wf_definitions/update_draft.js";
import type * as model_wf_definitions_update_workflow from "../model/wf_definitions/update_workflow.js";
import type * as model_wf_definitions_update_workflow_status from "../model/wf_definitions/update_workflow_status.js";
import type * as model_wf_definitions_validators from "../model/wf_definitions/validators.js";
import type * as model_wf_executions_complete_execution from "../model/wf_executions/complete_execution.js";
import type * as model_wf_executions_fail_execution from "../model/wf_executions/fail_execution.js";
import type * as model_wf_executions_get_execution from "../model/wf_executions/get_execution.js";
import type * as model_wf_executions_get_execution_step_journal from "../model/wf_executions/get_execution_step_journal.js";
import type * as model_wf_executions_get_raw_execution from "../model/wf_executions/get_raw_execution.js";
import type * as model_wf_executions_get_workflow_execution_stats from "../model/wf_executions/get_workflow_execution_stats.js";
import type * as model_wf_executions_index from "../model/wf_executions/index.js";
import type * as model_wf_executions_list_executions from "../model/wf_executions/list_executions.js";
import type * as model_wf_executions_list_executions_cursor from "../model/wf_executions/list_executions_cursor.js";
import type * as model_wf_executions_list_executions_paginated from "../model/wf_executions/list_executions_paginated.js";
import type * as model_wf_executions_patch_execution from "../model/wf_executions/patch_execution.js";
import type * as model_wf_executions_resume_execution from "../model/wf_executions/resume_execution.js";
import type * as model_wf_executions_set_component_workflow from "../model/wf_executions/set_component_workflow.js";
import type * as model_wf_executions_types from "../model/wf_executions/types.js";
import type * as model_wf_executions_update_execution_metadata from "../model/wf_executions/update_execution_metadata.js";
import type * as model_wf_executions_update_execution_status from "../model/wf_executions/update_execution_status.js";
import type * as model_wf_executions_update_execution_variables from "../model/wf_executions/update_execution_variables.js";
import type * as model_wf_executions_validators from "../model/wf_executions/validators.js";
import type * as model_wf_step_defs_create_step from "../model/wf_step_defs/create_step.js";
import type * as model_wf_step_defs_delete_step from "../model/wf_step_defs/delete_step.js";
import type * as model_wf_step_defs_get_next_step_in_sequence from "../model/wf_step_defs/get_next_step_in_sequence.js";
import type * as model_wf_step_defs_get_ordered_steps from "../model/wf_step_defs/get_ordered_steps.js";
import type * as model_wf_step_defs_get_step_by_order from "../model/wf_step_defs/get_step_by_order.js";
import type * as model_wf_step_defs_get_step_definition from "../model/wf_step_defs/get_step_definition.js";
import type * as model_wf_step_defs_get_steps_by_type from "../model/wf_step_defs/get_steps_by_type.js";
import type * as model_wf_step_defs_index from "../model/wf_step_defs/index.js";
import type * as model_wf_step_defs_list_workflow_steps from "../model/wf_step_defs/list_workflow_steps.js";
import type * as model_wf_step_defs_reorder_steps from "../model/wf_step_defs/reorder_steps.js";
import type * as model_wf_step_defs_types from "../model/wf_step_defs/types.js";
import type * as model_wf_step_defs_update_step from "../model/wf_step_defs/update_step.js";
import type * as model_wf_step_defs_validators from "../model/wf_step_defs/validators.js";
import type * as model_workflow_processing_records_ast_helpers_extract_comparison from "../model/workflow_processing_records/ast_helpers/extract_comparison.js";
import type * as model_workflow_processing_records_ast_helpers_extract_literal_value from "../model/workflow_processing_records/ast_helpers/extract_literal_value.js";
import type * as model_workflow_processing_records_ast_helpers_get_full_field_path from "../model/workflow_processing_records/ast_helpers/get_full_field_path.js";
import type * as model_workflow_processing_records_ast_helpers_index from "../model/workflow_processing_records/ast_helpers/index.js";
import type * as model_workflow_processing_records_ast_helpers_is_simple_field from "../model/workflow_processing_records/ast_helpers/is_simple_field.js";
import type * as model_workflow_processing_records_ast_helpers_merge_and_conditions from "../model/workflow_processing_records/ast_helpers/merge_and_conditions.js";
import type * as model_workflow_processing_records_ast_helpers_traverse_ast from "../model/workflow_processing_records/ast_helpers/traverse_ast.js";
import type * as model_workflow_processing_records_ast_helpers_types from "../model/workflow_processing_records/ast_helpers/types.js";
import type * as model_workflow_processing_records_calculate_cutoff_timestamp from "../model/workflow_processing_records/calculate_cutoff_timestamp.js";
import type * as model_workflow_processing_records_constants from "../model/workflow_processing_records/constants.js";
import type * as model_workflow_processing_records_find_and_claim_unprocessed from "../model/workflow_processing_records/find_and_claim_unprocessed.js";
import type * as model_workflow_processing_records_get_latest_processed_creation_time from "../model/workflow_processing_records/get_latest_processed_creation_time.js";
import type * as model_workflow_processing_records_get_processing_record_by_id from "../model/workflow_processing_records/get_processing_record_by_id.js";
import type * as model_workflow_processing_records_get_table_indexes from "../model/workflow_processing_records/get_table_indexes.js";
import type * as model_workflow_processing_records_index from "../model/workflow_processing_records/index.js";
import type * as model_workflow_processing_records_index_selection_group_conditions_by_field from "../model/workflow_processing_records/index_selection/group_conditions_by_field.js";
import type * as model_workflow_processing_records_index_selection_index from "../model/workflow_processing_records/index_selection/index.js";
import type * as model_workflow_processing_records_index_selection_score_index from "../model/workflow_processing_records/index_selection/score_index.js";
import type * as model_workflow_processing_records_index_selection_select_optimal_index from "../model/workflow_processing_records/index_selection/select_optimal_index.js";
import type * as model_workflow_processing_records_index_selection_types from "../model/workflow_processing_records/index_selection/types.js";
import type * as model_workflow_processing_records_is_record_processed from "../model/workflow_processing_records/is_record_processed.js";
import type * as model_workflow_processing_records_parse_filter_expression from "../model/workflow_processing_records/parse_filter_expression.js";
import type * as model_workflow_processing_records_query_building_create_expression_filter from "../model/workflow_processing_records/query_building/create_expression_filter.js";
import type * as model_workflow_processing_records_query_building_create_query_builder from "../model/workflow_processing_records/query_building/create_query_builder.js";
import type * as model_workflow_processing_records_query_building_find_unprocessed from "../model/workflow_processing_records/query_building/find_unprocessed.js";
import type * as model_workflow_processing_records_query_building_index from "../model/workflow_processing_records/query_building/index.js";
import type * as model_workflow_processing_records_query_building_types from "../model/workflow_processing_records/query_building/types.js";
import type * as model_workflow_processing_records_record_claimed from "../model/workflow_processing_records/record_claimed.js";
import type * as model_workflow_processing_records_record_processed from "../model/workflow_processing_records/record_processed.js";
import type * as model_workflow_processing_records_run_query from "../model/workflow_processing_records/run_query.js";
import type * as model_workflow_processing_records_types from "../model/workflow_processing_records/types.js";
import type * as node_only_documents_generate_excel_internal from "../node_only/documents/generate_excel_internal.js";
import type * as node_only_email_providers_test_connection from "../node_only/email_providers/test_connection.js";
import type * as node_only_gmail_send_email from "../node_only/gmail/send_email.js";
import type * as node_only_imap_lib_addresses from "../node_only/imap/lib/addresses.js";
import type * as node_only_imap_lib_build_email_message from "../node_only/imap/lib/build_email_message.js";
import type * as node_only_imap_lib_collect_thread_message_ids from "../node_only/imap/lib/collect_thread_message_ids.js";
import type * as node_only_imap_lib_compute_uids_to_fetch from "../node_only/imap/lib/compute_uids_to_fetch.js";
import type * as node_only_imap_lib_extract_thread_message_ids from "../node_only/imap/lib/extract_thread_message_ids.js";
import type * as node_only_imap_lib_fetch_and_parse_message from "../node_only/imap/lib/fetch_and_parse_message.js";
import type * as node_only_imap_lib_fetch_email_by_uid from "../node_only/imap/lib/fetch_email_by_uid.js";
import type * as node_only_imap_lib_fetch_messages_from_search_results from "../node_only/imap/lib/fetch_messages_from_search_results.js";
import type * as node_only_imap_lib_find_message_in_folders from "../node_only/imap/lib/find_message_in_folders.js";
import type * as node_only_imap_lib_find_replies_to_message from "../node_only/imap/lib/find_replies_to_message.js";
import type * as node_only_imap_lib_find_root_message from "../node_only/imap/lib/find_root_message.js";
import type * as node_only_imap_lib_list_all_folders from "../node_only/imap/lib/list_all_folders.js";
import type * as node_only_imap_lib_normalize_message_id from "../node_only/imap/lib/normalize_message_id.js";
import type * as node_only_imap_lib_normalize_message_id_for_search from "../node_only/imap/lib/normalize_message_id_for_search.js";
import type * as node_only_imap_lib_parse_headers from "../node_only/imap/lib/parse_headers.js";
import type * as node_only_imap_lib_search_in_folder from "../node_only/imap/lib/search_in_folder.js";
import type * as node_only_imap_lib_search_thread_messages from "../node_only/imap/lib/search_thread_messages.js";
import type * as node_only_imap_retrieve_imap_emails from "../node_only/imap/retrieve_imap_emails.js";
import type * as node_only_integration_sandbox_execute_integration_internal from "../node_only/integration_sandbox/execute_integration_internal.js";
import type * as node_only_integration_sandbox_helpers_base64_decode from "../node_only/integration_sandbox/helpers/base64_decode.js";
import type * as node_only_integration_sandbox_helpers_base64_encode from "../node_only/integration_sandbox/helpers/base64_encode.js";
import type * as node_only_integration_sandbox_helpers_create_http_api from "../node_only/integration_sandbox/helpers/create_http_api.js";
import type * as node_only_integration_sandbox_helpers_create_sandbox from "../node_only/integration_sandbox/helpers/create_sandbox.js";
import type * as node_only_integration_sandbox_helpers_create_secrets_api from "../node_only/integration_sandbox/helpers/create_secrets_api.js";
import type * as node_only_integration_sandbox_helpers_execute_http_request from "../node_only/integration_sandbox/helpers/execute_http_request.js";
import type * as node_only_integration_sandbox_helpers_index from "../node_only/integration_sandbox/helpers/index.js";
import type * as node_only_integration_sandbox_types from "../node_only/integration_sandbox/types.js";
import type * as node_only_microsoft_graph_send_email from "../node_only/microsoft_graph/send_email.js";
import type * as node_only_smtp_send_email from "../node_only/smtp/send_email.js";
import type * as node_only_sql_execute_query_internal from "../node_only/sql/execute_query_internal.js";
import type * as node_only_sql_helpers_execute_mssql_query from "../node_only/sql/helpers/execute_mssql_query.js";
import type * as node_only_sql_helpers_execute_mysql_query from "../node_only/sql/helpers/execute_mysql_query.js";
import type * as node_only_sql_helpers_execute_postgres_query from "../node_only/sql/helpers/execute_postgres_query.js";
import type * as node_only_sql_helpers_execute_query from "../node_only/sql/helpers/execute_query.js";
import type * as node_only_sql_helpers_validate_query from "../node_only/sql/helpers/validate_query.js";
import type * as node_only_sql_types from "../node_only/sql/types.js";
import type * as oauth2 from "../oauth2.js";
import type * as onedrive from "../onedrive.js";
import type * as organizations from "../organizations.js";
import type * as predefined_integrations_circuly from "../predefined_integrations/circuly.js";
import type * as predefined_integrations_index from "../predefined_integrations/index.js";
import type * as predefined_integrations_protel from "../predefined_integrations/protel.js";
import type * as predefined_integrations_shopify from "../predefined_integrations/shopify.js";
import type * as predefined_integrations_types from "../predefined_integrations/types.js";
import type * as predefined_workflows_circuly_sync_customers from "../predefined_workflows/circuly_sync_customers.js";
import type * as predefined_workflows_circuly_sync_products from "../predefined_workflows/circuly_sync_products.js";
import type * as predefined_workflows_circuly_sync_subscriptions from "../predefined_workflows/circuly_sync_subscriptions.js";
import type * as predefined_workflows_conversation_auto_archive from "../predefined_workflows/conversation_auto_archive.js";
import type * as predefined_workflows_conversation_auto_reply from "../predefined_workflows/conversation_auto_reply.js";
import type * as predefined_workflows_customer_rag_sync from "../predefined_workflows/customer_rag_sync.js";
import type * as predefined_workflows_document_rag_sync from "../predefined_workflows/document_rag_sync.js";
import type * as predefined_workflows_email_sync_imap from "../predefined_workflows/email_sync_imap.js";
import type * as predefined_workflows_email_sync_sent_imap from "../predefined_workflows/email_sync_sent_imap.js";
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
import type * as products from "../products.js";
import type * as streaming from "../streaming.js";
import type * as threads from "../threads.js";
import type * as tone_of_voice from "../tone_of_voice.js";
import type * as trusted_headers_authenticate from "../trusted_headers_authenticate.js";
import type * as users from "../users.js";
import type * as vendors from "../vendors.js";
import type * as websites from "../websites.js";
import type * as wf_definitions from "../wf_definitions.js";
import type * as wf_executions from "../wf_executions.js";
import type * as wf_step_defs from "../wf_step_defs.js";
import type * as workflow_actions_action_registry from "../workflow/actions/action_registry.js";
import type * as workflow_actions_approval_approval_action from "../workflow/actions/approval/approval_action.js";
import type * as workflow_actions_approval_helpers_create_approval from "../workflow/actions/approval/helpers/create_approval.js";
import type * as workflow_actions_approval_helpers_types from "../workflow/actions/approval/helpers/types.js";
import type * as workflow_actions_conversation_conversation_action from "../workflow/actions/conversation/conversation_action.js";
import type * as workflow_actions_conversation_helpers_add_message_to_conversation from "../workflow/actions/conversation/helpers/add_message_to_conversation.js";
import type * as workflow_actions_conversation_helpers_build_conversation_metadata from "../workflow/actions/conversation/helpers/build_conversation_metadata.js";
import type * as workflow_actions_conversation_helpers_build_email_metadata from "../workflow/actions/conversation/helpers/build_email_metadata.js";
import type * as workflow_actions_conversation_helpers_build_initial_message from "../workflow/actions/conversation/helpers/build_initial_message.js";
import type * as workflow_actions_conversation_helpers_check_conversation_exists from "../workflow/actions/conversation/helpers/check_conversation_exists.js";
import type * as workflow_actions_conversation_helpers_check_message_exists from "../workflow/actions/conversation/helpers/check_message_exists.js";
import type * as workflow_actions_conversation_helpers_create_conversation from "../workflow/actions/conversation/helpers/create_conversation.js";
import type * as workflow_actions_conversation_helpers_create_conversation_from_email from "../workflow/actions/conversation/helpers/create_conversation_from_email.js";
import type * as workflow_actions_conversation_helpers_create_conversation_from_sent_email from "../workflow/actions/conversation/helpers/create_conversation_from_sent_email.js";
import type * as workflow_actions_conversation_helpers_find_or_create_customer_from_email from "../workflow/actions/conversation/helpers/find_or_create_customer_from_email.js";
import type * as workflow_actions_conversation_helpers_find_related_conversation from "../workflow/actions/conversation/helpers/find_related_conversation.js";
import type * as workflow_actions_conversation_helpers_query_conversation_messages from "../workflow/actions/conversation/helpers/query_conversation_messages.js";
import type * as workflow_actions_conversation_helpers_query_latest_message_by_delivery_state from "../workflow/actions/conversation/helpers/query_latest_message_by_delivery_state.js";
import type * as workflow_actions_conversation_helpers_types from "../workflow/actions/conversation/helpers/types.js";
import type * as workflow_actions_conversation_helpers_update_conversations from "../workflow/actions/conversation/helpers/update_conversations.js";
import type * as workflow_actions_conversation_helpers_update_message from "../workflow/actions/conversation/helpers/update_message.js";
import type * as workflow_actions_crawler_crawler_action from "../workflow/actions/crawler/crawler_action.js";
import type * as workflow_actions_crawler_helpers_types from "../workflow/actions/crawler/helpers/types.js";
import type * as workflow_actions_customer_customer_action from "../workflow/actions/customer/customer_action.js";
import type * as workflow_actions_document_document_action from "../workflow/actions/document/document_action.js";
import type * as workflow_actions_email_provider_email_provider_action from "../workflow/actions/email_provider/email_provider_action.js";
import type * as workflow_actions_imap_helpers_get_imap_credentials from "../workflow/actions/imap/helpers/get_imap_credentials.js";
import type * as workflow_actions_imap_helpers_types from "../workflow/actions/imap/helpers/types.js";
import type * as workflow_actions_imap_imap_action from "../workflow/actions/imap/imap_action.js";
import type * as workflow_actions_integration_helpers_build_secrets_from_integration from "../workflow/actions/integration/helpers/build_secrets_from_integration.js";
import type * as workflow_actions_integration_helpers_decrypt_sql_credentials from "../workflow/actions/integration/helpers/decrypt_sql_credentials.js";
import type * as workflow_actions_integration_helpers_detect_write_operation from "../workflow/actions/integration/helpers/detect_write_operation.js";
import type * as workflow_actions_integration_helpers_execute_sql_integration from "../workflow/actions/integration/helpers/execute_sql_integration.js";
import type * as workflow_actions_integration_helpers_get_introspect_columns_query from "../workflow/actions/integration/helpers/get_introspect_columns_query.js";
import type * as workflow_actions_integration_helpers_get_introspect_tables_query from "../workflow/actions/integration/helpers/get_introspect_tables_query.js";
import type * as workflow_actions_integration_helpers_get_introspection_operations from "../workflow/actions/integration/helpers/get_introspection_operations.js";
import type * as workflow_actions_integration_helpers_is_introspection_operation from "../workflow/actions/integration/helpers/is_introspection_operation.js";
import type * as workflow_actions_integration_helpers_validate_required_parameters from "../workflow/actions/integration/helpers/validate_required_parameters.js";
import type * as workflow_actions_integration_integration_action from "../workflow/actions/integration/integration_action.js";
import type * as workflow_actions_onedrive_onedrive_action from "../workflow/actions/onedrive/onedrive_action.js";
import type * as workflow_actions_product_product_action from "../workflow/actions/product/product_action.js";
import type * as workflow_actions_rag_helpers_delete_document from "../workflow/actions/rag/helpers/delete_document.js";
import type * as workflow_actions_rag_helpers_get_document_info from "../workflow/actions/rag/helpers/get_document_info.js";
import type * as workflow_actions_rag_helpers_get_rag_config from "../workflow/actions/rag/helpers/get_rag_config.js";
import type * as workflow_actions_rag_helpers_types from "../workflow/actions/rag/helpers/types.js";
import type * as workflow_actions_rag_helpers_upload_file_direct from "../workflow/actions/rag/helpers/upload_file_direct.js";
import type * as workflow_actions_rag_helpers_upload_text_document from "../workflow/actions/rag/helpers/upload_text_document.js";
import type * as workflow_actions_rag_rag_action from "../workflow/actions/rag/rag_action.js";
import type * as workflow_actions_set_variables_action from "../workflow/actions/set_variables_action.js";
import type * as workflow_actions_tone_of_voice_tone_of_voice_action from "../workflow/actions/tone_of_voice/tone_of_voice_action.js";
import type * as workflow_actions_website_helpers_types from "../workflow/actions/website/helpers/types.js";
import type * as workflow_actions_website_website_action from "../workflow/actions/website/website_action.js";
import type * as workflow_actions_websitePages_helpers_types from "../workflow/actions/websitePages/helpers/types.js";
import type * as workflow_actions_websitePages_websitePages_action from "../workflow/actions/websitePages/websitePages_action.js";
import type * as workflow_actions_workflow_helpers_types from "../workflow/actions/workflow/helpers/types.js";
import type * as workflow_actions_workflow_helpers_upload_workflows from "../workflow/actions/workflow/helpers/upload_workflows.js";
import type * as workflow_actions_workflow_workflow_action from "../workflow/actions/workflow/workflow_action.js";
import type * as workflow_actions_workflow_processing_records_helpers_find_unprocessed from "../workflow/actions/workflow_processing_records/helpers/find_unprocessed.js";
import type * as workflow_actions_workflow_processing_records_helpers_record_processed from "../workflow/actions/workflow_processing_records/helpers/record_processed.js";
import type * as workflow_actions_workflow_processing_records_helpers_types from "../workflow/actions/workflow_processing_records/helpers/types.js";
import type * as workflow_actions_workflow_processing_records_workflow_processing_records_action from "../workflow/actions/workflow_processing_records/workflow_processing_records_action.js";
import type * as workflow_engine from "../workflow/engine.js";
import type * as workflow_helpers_data_source_database_workflow_data_source from "../workflow/helpers/data_source/database_workflow_data_source.js";
import type * as workflow_helpers_data_source_types from "../workflow/helpers/data_source/types.js";
import type * as workflow_helpers_engine_build_steps_config_map from "../workflow/helpers/engine/build_steps_config_map.js";
import type * as workflow_helpers_engine_cleanup_component_workflow from "../workflow/helpers/engine/cleanup_component_workflow.js";
import type * as workflow_helpers_engine_dynamic_workflow_handler from "../workflow/helpers/engine/dynamic_workflow_handler.js";
import type * as workflow_helpers_engine_execute_step_handler from "../workflow/helpers/engine/execute_step_handler.js";
import type * as workflow_helpers_engine_execute_workflow_start from "../workflow/helpers/engine/execute_workflow_start.js";
import type * as workflow_helpers_engine_index from "../workflow/helpers/engine/index.js";
import type * as workflow_helpers_engine_load_database_workflow from "../workflow/helpers/engine/load_database_workflow.js";
import type * as workflow_helpers_engine_mark_execution_completed_handler from "../workflow/helpers/engine/mark_execution_completed_handler.js";
import type * as workflow_helpers_engine_on_workflow_complete from "../workflow/helpers/engine/on_workflow_complete.js";
import type * as workflow_helpers_engine_start_workflow_handler from "../workflow/helpers/engine/start_workflow_handler.js";
import type * as workflow_helpers_engine_workflow_data from "../workflow/helpers/engine/workflow_data.js";
import type * as workflow_helpers_formatting_stringify from "../workflow/helpers/formatting/stringify.js";
import type * as workflow_helpers_nodes_action_execute_action_node from "../workflow/helpers/nodes/action/execute_action_node.js";
import type * as workflow_helpers_nodes_action_get_action from "../workflow/helpers/nodes/action/get_action.js";
import type * as workflow_helpers_nodes_action_list_actions from "../workflow/helpers/nodes/action/list_actions.js";
import type * as workflow_helpers_nodes_action_types from "../workflow/helpers/nodes/action/types.js";
import type * as workflow_helpers_nodes_condition_execute_condition_node from "../workflow/helpers/nodes/condition/execute_condition_node.js";
import type * as workflow_helpers_nodes_constants from "../workflow/helpers/nodes/constants.js";
import type * as workflow_helpers_nodes_llm_execute_agent_with_tools from "../workflow/helpers/nodes/llm/execute_agent_with_tools.js";
import type * as workflow_helpers_nodes_llm_execute_llm_node from "../workflow/helpers/nodes/llm/execute_llm_node.js";
import type * as workflow_helpers_nodes_llm_extract_json_from_text from "../workflow/helpers/nodes/llm/extract_json_from_text.js";
import type * as workflow_helpers_nodes_llm_types from "../workflow/helpers/nodes/llm/types.js";
import type * as workflow_helpers_nodes_llm_types_workflow_termination from "../workflow/helpers/nodes/llm/types/workflow_termination.js";
import type * as workflow_helpers_nodes_llm_utils_build_agent_steps_summary from "../workflow/helpers/nodes/llm/utils/build_agent_steps_summary.js";
import type * as workflow_helpers_nodes_llm_utils_create_llm_result from "../workflow/helpers/nodes/llm/utils/create_llm_result.js";
import type * as workflow_helpers_nodes_llm_utils_extract_tool_diagnostics from "../workflow/helpers/nodes/llm/utils/extract_tool_diagnostics.js";
import type * as workflow_helpers_nodes_llm_utils_process_agent_result from "../workflow/helpers/nodes/llm/utils/process_agent_result.js";
import type * as workflow_helpers_nodes_llm_utils_process_prompts from "../workflow/helpers/nodes/llm/utils/process_prompts.js";
import type * as workflow_helpers_nodes_llm_utils_validate_and_normalize_config from "../workflow/helpers/nodes/llm/utils/validate_and_normalize_config.js";
import type * as workflow_helpers_nodes_loop_execute_loop_node from "../workflow/helpers/nodes/loop/execute_loop_node.js";
import type * as workflow_helpers_nodes_loop_loop_node_executor from "../workflow/helpers/nodes/loop/loop_node_executor.js";
import type * as workflow_helpers_nodes_loop_utils_create_loop_result from "../workflow/helpers/nodes/loop/utils/create_loop_result.js";
import type * as workflow_helpers_nodes_loop_utils_create_loop_state from "../workflow/helpers/nodes/loop/utils/create_loop_state.js";
import type * as workflow_helpers_nodes_loop_utils_get_input_data from "../workflow/helpers/nodes/loop/utils/get_input_data.js";
import type * as workflow_helpers_nodes_loop_utils_get_loop_items from "../workflow/helpers/nodes/loop/utils/get_loop_items.js";
import type * as workflow_helpers_nodes_loop_utils_is_loop_in_progress from "../workflow/helpers/nodes/loop/utils/is_loop_in_progress.js";
import type * as workflow_helpers_nodes_trigger_execute_trigger_node from "../workflow/helpers/nodes/trigger/execute_trigger_node.js";
import type * as workflow_helpers_nodes_trigger_process_trigger_config from "../workflow/helpers/nodes/trigger/process_trigger_config.js";
import type * as workflow_helpers_scheduler_get_last_execution_time from "../workflow/helpers/scheduler/get_last_execution_time.js";
import type * as workflow_helpers_scheduler_get_scheduled_workflows from "../workflow/helpers/scheduler/get_scheduled_workflows.js";
import type * as workflow_helpers_scheduler_index from "../workflow/helpers/scheduler/index.js";
import type * as workflow_helpers_scheduler_scan_and_trigger from "../workflow/helpers/scheduler/scan_and_trigger.js";
import type * as workflow_helpers_scheduler_should_trigger_workflow from "../workflow/helpers/scheduler/should_trigger_workflow.js";
import type * as workflow_helpers_scheduler_trigger_workflow_by_id from "../workflow/helpers/scheduler/trigger_workflow_by_id.js";
import type * as workflow_helpers_serialization_deserialize_variables from "../workflow/helpers/serialization/deserialize_variables.js";
import type * as workflow_helpers_serialization_serialize_variables from "../workflow/helpers/serialization/serialize_variables.js";
import type * as workflow_helpers_step_execution_build_steps_map from "../workflow/helpers/step_execution/build_steps_map.js";
import type * as workflow_helpers_step_execution_decrypt_and_merge_secrets from "../workflow/helpers/step_execution/decrypt_and_merge_secrets.js";
import type * as workflow_helpers_step_execution_execute_step_by_type from "../workflow/helpers/step_execution/execute_step_by_type.js";
import type * as workflow_helpers_step_execution_extract_essential_loop_variables from "../workflow/helpers/step_execution/extract_essential_loop_variables.js";
import type * as workflow_helpers_step_execution_extract_loop_variables from "../workflow/helpers/step_execution/extract_loop_variables.js";
import type * as workflow_helpers_step_execution_extract_steps_with_outputs from "../workflow/helpers/step_execution/extract_steps_with_outputs.js";
import type * as workflow_helpers_step_execution_initialize_execution_variables from "../workflow/helpers/step_execution/initialize_execution_variables.js";
import type * as workflow_helpers_step_execution_load_and_validate_execution from "../workflow/helpers/step_execution/load_and_validate_execution.js";
import type * as workflow_helpers_step_execution_merge_execution_variables from "../workflow/helpers/step_execution/merge_execution_variables.js";
import type * as workflow_helpers_step_execution_persist_execution_result from "../workflow/helpers/step_execution/persist_execution_result.js";
import type * as workflow_helpers_step_execution_types from "../workflow/helpers/step_execution/types.js";
import type * as workflow_helpers_validation_constants from "../workflow/helpers/validation/constants.js";
import type * as workflow_helpers_validation_index from "../workflow/helpers/validation/index.js";
import type * as workflow_helpers_validation_steps_action from "../workflow/helpers/validation/steps/action.js";
import type * as workflow_helpers_validation_steps_condition from "../workflow/helpers/validation/steps/condition.js";
import type * as workflow_helpers_validation_steps_index from "../workflow/helpers/validation/steps/index.js";
import type * as workflow_helpers_validation_steps_llm from "../workflow/helpers/validation/steps/llm.js";
import type * as workflow_helpers_validation_steps_loop from "../workflow/helpers/validation/steps/loop.js";
import type * as workflow_helpers_validation_steps_trigger from "../workflow/helpers/validation/steps/trigger.js";
import type * as workflow_helpers_validation_types from "../workflow/helpers/validation/types.js";
import type * as workflow_helpers_validation_validate_action_parameters from "../workflow/helpers/validation/validate_action_parameters.js";
import type * as workflow_helpers_validation_validate_step_config from "../workflow/helpers/validation/validate_step_config.js";
import type * as workflow_helpers_validation_validate_workflow_definition from "../workflow/helpers/validation/validate_workflow_definition.js";
import type * as workflow_helpers_validation_validate_workflow_steps from "../workflow/helpers/validation/validate_workflow_steps.js";
import type * as workflow_helpers_validation_variables_action_schemas from "../workflow/helpers/validation/variables/action_schemas.js";
import type * as workflow_helpers_validation_variables_index from "../workflow/helpers/validation/variables/index.js";
import type * as workflow_helpers_validation_variables_parse from "../workflow/helpers/validation/variables/parse.js";
import type * as workflow_helpers_validation_variables_step_schemas from "../workflow/helpers/validation/variables/step_schemas.js";
import type * as workflow_helpers_validation_variables_types from "../workflow/helpers/validation/variables/types.js";
import type * as workflow_helpers_validation_variables_validate from "../workflow/helpers/validation/variables/validate.js";
import type * as workflow_helpers_variables_decrypt_inline_secrets from "../workflow/helpers/variables/decrypt_inline_secrets.js";
import type * as workflow_instructions_core_instructions from "../workflow/instructions/core_instructions.js";
import type * as workflow_nodes from "../workflow/nodes.js";
import type * as workflow_scheduler from "../workflow/scheduler.js";
import type * as workflow_types_execution from "../workflow/types/execution.js";
import type * as workflow_types_index from "../workflow/types/index.js";
import type * as workflow_types_nodes from "../workflow/types/nodes.js";
import type * as workflow_types_workflow from "../workflow/types/workflow.js";
import type * as workflow_types_workflow_types from "../workflow/types/workflow_types.js";
import type * as workflow_workflow_syntax_compact from "../workflow/workflow_syntax_compact.js";
import type * as workflow_assistant_agent from "../workflow_assistant_agent.js";
import type * as workflow_processing_records from "../workflow_processing_records.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  "agent_tools/crawler/helpers/fetch_page_content": typeof agent_tools_crawler_helpers_fetch_page_content;
  "agent_tools/crawler/helpers/fetch_searxng_results": typeof agent_tools_crawler_helpers_fetch_searxng_results;
  "agent_tools/crawler/helpers/get_crawler_service_url": typeof agent_tools_crawler_helpers_get_crawler_service_url;
  "agent_tools/crawler/helpers/get_search_service_url": typeof agent_tools_crawler_helpers_get_search_service_url;
  "agent_tools/crawler/helpers/search_and_fetch": typeof agent_tools_crawler_helpers_search_and_fetch;
  "agent_tools/crawler/helpers/search_web": typeof agent_tools_crawler_helpers_search_web;
  "agent_tools/crawler/helpers/types": typeof agent_tools_crawler_helpers_types;
  "agent_tools/crawler/internal_actions": typeof agent_tools_crawler_internal_actions;
  "agent_tools/crawler/web_read_tool": typeof agent_tools_crawler_web_read_tool;
  "agent_tools/create_json_output_tool": typeof agent_tools_create_json_output_tool;
  "agent_tools/customers/customer_read_tool": typeof agent_tools_customers_customer_read_tool;
  "agent_tools/customers/helpers/read_customer_by_email": typeof agent_tools_customers_helpers_read_customer_by_email;
  "agent_tools/customers/helpers/read_customer_by_id": typeof agent_tools_customers_helpers_read_customer_by_id;
  "agent_tools/customers/helpers/read_customer_list": typeof agent_tools_customers_helpers_read_customer_list;
  "agent_tools/customers/helpers/types": typeof agent_tools_customers_helpers_types;
  "agent_tools/database/database_schema_tool": typeof agent_tools_database_database_schema_tool;
  "agent_tools/database/helpers/schema_definitions": typeof agent_tools_database_helpers_schema_definitions;
  "agent_tools/database/helpers/types": typeof agent_tools_database_helpers_types;
  "agent_tools/files/docx_tool": typeof agent_tools_files_docx_tool;
  "agent_tools/files/generate_excel_tool": typeof agent_tools_files_generate_excel_tool;
  "agent_tools/files/helpers/analyze_image": typeof agent_tools_files_helpers_analyze_image;
  "agent_tools/files/helpers/analyze_image_by_url": typeof agent_tools_files_helpers_analyze_image_by_url;
  "agent_tools/files/helpers/check_resource_accessible": typeof agent_tools_files_helpers_check_resource_accessible;
  "agent_tools/files/helpers/parse_file": typeof agent_tools_files_helpers_parse_file;
  "agent_tools/files/helpers/vision_agent": typeof agent_tools_files_helpers_vision_agent;
  "agent_tools/files/image_tool": typeof agent_tools_files_image_tool;
  "agent_tools/files/internal_actions": typeof agent_tools_files_internal_actions;
  "agent_tools/files/pdf_tool": typeof agent_tools_files_pdf_tool;
  "agent_tools/files/pptx_tool": typeof agent_tools_files_pptx_tool;
  "agent_tools/files/resource_check_tool": typeof agent_tools_files_resource_check_tool;
  "agent_tools/integrations/create_integration_approval": typeof agent_tools_integrations_create_integration_approval;
  "agent_tools/integrations/execute_approved_operation": typeof agent_tools_integrations_execute_approved_operation;
  "agent_tools/integrations/execute_batch_integration_internal": typeof agent_tools_integrations_execute_batch_integration_internal;
  "agent_tools/integrations/execute_integration_internal": typeof agent_tools_integrations_execute_integration_internal;
  "agent_tools/integrations/integration_batch_tool": typeof agent_tools_integrations_integration_batch_tool;
  "agent_tools/integrations/integration_introspect_tool": typeof agent_tools_integrations_integration_introspect_tool;
  "agent_tools/integrations/integration_tool": typeof agent_tools_integrations_integration_tool;
  "agent_tools/integrations/types": typeof agent_tools_integrations_types;
  "agent_tools/integrations/verify_approval_tool": typeof agent_tools_integrations_verify_approval_tool;
  "agent_tools/load_convex_tools_as_object": typeof agent_tools_load_convex_tools_as_object;
  "agent_tools/products/helpers/read_product_by_id": typeof agent_tools_products_helpers_read_product_by_id;
  "agent_tools/products/helpers/read_product_list": typeof agent_tools_products_helpers_read_product_list;
  "agent_tools/products/helpers/types": typeof agent_tools_products_helpers_types;
  "agent_tools/products/product_read_tool": typeof agent_tools_products_product_read_tool;
  "agent_tools/rag/query_rag_context": typeof agent_tools_rag_query_rag_context;
  "agent_tools/rag/rag_search_tool": typeof agent_tools_rag_rag_search_tool;
  "agent_tools/sub_agents/document_assistant_tool": typeof agent_tools_sub_agents_document_assistant_tool;
  "agent_tools/sub_agents/helpers/format_integrations": typeof agent_tools_sub_agents_helpers_format_integrations;
  "agent_tools/sub_agents/helpers/get_or_create_sub_thread": typeof agent_tools_sub_agents_helpers_get_or_create_sub_thread;
  "agent_tools/sub_agents/helpers/types": typeof agent_tools_sub_agents_helpers_types;
  "agent_tools/sub_agents/instructions/document_instructions": typeof agent_tools_sub_agents_instructions_document_instructions;
  "agent_tools/sub_agents/instructions/integration_instructions": typeof agent_tools_sub_agents_instructions_integration_instructions;
  "agent_tools/sub_agents/instructions/web_instructions": typeof agent_tools_sub_agents_instructions_web_instructions;
  "agent_tools/sub_agents/integration_assistant_tool": typeof agent_tools_sub_agents_integration_assistant_tool;
  "agent_tools/sub_agents/web_assistant_tool": typeof agent_tools_sub_agents_web_assistant_tool;
  "agent_tools/sub_agents/workflow_assistant_tool": typeof agent_tools_sub_agents_workflow_assistant_tool;
  "agent_tools/threads/context_search_tool": typeof agent_tools_threads_context_search_tool;
  "agent_tools/tool_registry": typeof agent_tools_tool_registry;
  "agent_tools/types": typeof agent_tools_types;
  "agent_tools/workflows/create_workflow_approval": typeof agent_tools_workflows_create_workflow_approval;
  "agent_tools/workflows/create_workflow_tool": typeof agent_tools_workflows_create_workflow_tool;
  "agent_tools/workflows/execute_approved_workflow_creation": typeof agent_tools_workflows_execute_approved_workflow_creation;
  "agent_tools/workflows/helpers/read_active_version_steps": typeof agent_tools_workflows_helpers_read_active_version_steps;
  "agent_tools/workflows/helpers/read_all_workflows": typeof agent_tools_workflows_helpers_read_all_workflows;
  "agent_tools/workflows/helpers/read_predefined_workflows": typeof agent_tools_workflows_helpers_read_predefined_workflows;
  "agent_tools/workflows/helpers/read_version_history": typeof agent_tools_workflows_helpers_read_version_history;
  "agent_tools/workflows/helpers/read_workflow_examples": typeof agent_tools_workflows_helpers_read_workflow_examples;
  "agent_tools/workflows/helpers/read_workflow_structure": typeof agent_tools_workflows_helpers_read_workflow_structure;
  "agent_tools/workflows/helpers/syntax_reference": typeof agent_tools_workflows_helpers_syntax_reference;
  "agent_tools/workflows/helpers/types": typeof agent_tools_workflows_helpers_types;
  "agent_tools/workflows/save_workflow_definition_tool": typeof agent_tools_workflows_save_workflow_definition_tool;
  "agent_tools/workflows/update_workflow_step_tool": typeof agent_tools_workflows_update_workflow_step_tool;
  "agent_tools/workflows/workflow_examples_tool": typeof agent_tools_workflows_workflow_examples_tool;
  "agent_tools/workflows/workflow_read_tool": typeof agent_tools_workflows_workflow_read_tool;
  approvals: typeof approvals;
  auth: typeof auth;
  chat_agent: typeof chat_agent;
  constants: typeof constants;
  conversations: typeof conversations;
  crons: typeof crons;
  customers: typeof customers;
  documents: typeof documents;
  email_providers: typeof email_providers;
  file: typeof file;
  http: typeof http;
  improve_message: typeof improve_message;
  integrations: typeof integrations;
  "lib/action_cache/index": typeof lib_action_cache_index;
  "lib/attachments/build_multi_modal_content": typeof lib_attachments_build_multi_modal_content;
  "lib/attachments/format_markdown": typeof lib_attachments_format_markdown;
  "lib/attachments/index": typeof lib_attachments_index;
  "lib/attachments/register_files": typeof lib_attachments_register_files;
  "lib/attachments/types": typeof lib_attachments_types;
  "lib/create_agent_config": typeof lib_create_agent_config;
  "lib/create_chat_agent": typeof lib_create_chat_agent;
  "lib/create_document_agent": typeof lib_create_document_agent;
  "lib/create_integration_agent": typeof lib_create_integration_agent;
  "lib/create_web_agent": typeof lib_create_web_agent;
  "lib/create_workflow_agent": typeof lib_create_workflow_agent;
  "lib/crypto/base64_to_bytes": typeof lib_crypto_base64_to_bytes;
  "lib/crypto/base64_url_to_buffer": typeof lib_crypto_base64_url_to_buffer;
  "lib/crypto/decrypt_string": typeof lib_crypto_decrypt_string;
  "lib/crypto/encrypt_string": typeof lib_crypto_encrypt_string;
  "lib/crypto/generate_secure_state": typeof lib_crypto_generate_secure_state;
  "lib/crypto/get_secret_key": typeof lib_crypto_get_secret_key;
  "lib/crypto/hex_to_bytes": typeof lib_crypto_hex_to_bytes;
  "lib/debug_log": typeof lib_debug_log;
  "lib/error_classification": typeof lib_error_classification;
  "lib/openai_provider": typeof lib_openai_provider;
  "lib/pagination/helpers": typeof lib_pagination_helpers;
  "lib/pagination/index": typeof lib_pagination_index;
  "lib/pagination/types": typeof lib_pagination_types;
  "lib/query_builder/build_query": typeof lib_query_builder_build_query;
  "lib/query_builder/index": typeof lib_query_builder_index;
  "lib/query_builder/select_index": typeof lib_query_builder_select_index;
  "lib/query_builder/types": typeof lib_query_builder_types;
  "lib/rate_limiter/helpers": typeof lib_rate_limiter_helpers;
  "lib/rate_limiter/index": typeof lib_rate_limiter_index;
  "lib/rls/auth/get_authenticated_user": typeof lib_rls_auth_get_authenticated_user;
  "lib/rls/auth/require_authenticated_user": typeof lib_rls_auth_require_authenticated_user;
  "lib/rls/context/create_org_query_builder": typeof lib_rls_context_create_org_query_builder;
  "lib/rls/context/create_rls_context": typeof lib_rls_context_create_rls_context;
  "lib/rls/errors": typeof lib_rls_errors;
  "lib/rls/helpers/mutation_with_rls": typeof lib_rls_helpers_mutation_with_rls;
  "lib/rls/helpers/query_with_rls": typeof lib_rls_helpers_query_with_rls;
  "lib/rls/helpers/rls_rules": typeof lib_rls_helpers_rls_rules;
  "lib/rls/index": typeof lib_rls_index;
  "lib/rls/organization/get_organization_member": typeof lib_rls_organization_get_organization_member;
  "lib/rls/organization/get_user_organizations": typeof lib_rls_organization_get_user_organizations;
  "lib/rls/organization/validate_organization_access": typeof lib_rls_organization_validate_organization_access;
  "lib/rls/organization/validate_resource_organization": typeof lib_rls_organization_validate_resource_organization;
  "lib/rls/types": typeof lib_rls_types;
  "lib/rls/validators": typeof lib_rls_validators;
  "lib/rls/wrappers/with_organization_rls": typeof lib_rls_wrappers_with_organization_rls;
  "lib/rls/wrappers/with_resource_rls": typeof lib_rls_wrappers_with_resource_rls;
  "lib/summarize_context": typeof lib_summarize_context;
  "lib/variables/build_context": typeof lib_variables_build_context;
  "lib/variables/evaluate_expression": typeof lib_variables_evaluate_expression;
  "lib/variables/jexl_instance": typeof lib_variables_jexl_instance;
  "lib/variables/replace_variables": typeof lib_variables_replace_variables;
  "lib/variables/replace_variables_in_string": typeof lib_variables_replace_variables_in_string;
  "lib/variables/validate_template": typeof lib_variables_validate_template;
  member: typeof member;
  message_metadata: typeof message_metadata;
  "model/accounts/index": typeof model_accounts_index;
  "model/accounts/microsoft/get_microsoft_account": typeof model_accounts_microsoft_get_microsoft_account;
  "model/accounts/microsoft/get_microsoft_account_by_user_id": typeof model_accounts_microsoft_get_microsoft_account_by_user_id;
  "model/accounts/microsoft/has_microsoft_account": typeof model_accounts_microsoft_has_microsoft_account;
  "model/accounts/microsoft/index": typeof model_accounts_microsoft_index;
  "model/accounts/microsoft/update_microsoft_tokens": typeof model_accounts_microsoft_update_microsoft_tokens;
  "model/approvals/create_approval": typeof model_approvals_create_approval;
  "model/approvals/get_approval": typeof model_approvals_get_approval;
  "model/approvals/get_approval_history": typeof model_approvals_get_approval_history;
  "model/approvals/index": typeof model_approvals_index;
  "model/approvals/link_approvals_to_message": typeof model_approvals_link_approvals_to_message;
  "model/approvals/list_approvals_by_organization": typeof model_approvals_list_approvals_by_organization;
  "model/approvals/list_approvals_for_execution": typeof model_approvals_list_approvals_for_execution;
  "model/approvals/list_pending_approvals": typeof model_approvals_list_pending_approvals;
  "model/approvals/list_pending_approvals_for_execution": typeof model_approvals_list_pending_approvals_for_execution;
  "model/approvals/remove_recommended_product": typeof model_approvals_remove_recommended_product;
  "model/approvals/types": typeof model_approvals_types;
  "model/approvals/update_approval_status": typeof model_approvals_update_approval_status;
  "model/approvals/validators": typeof model_approvals_validators;
  "model/chat_agent/auto_summarize_if_needed": typeof model_chat_agent_auto_summarize_if_needed;
  "model/chat_agent/chat_with_agent": typeof model_chat_agent_chat_with_agent;
  "model/chat_agent/context_management/check_and_summarize": typeof model_chat_agent_context_management_check_and_summarize;
  "model/chat_agent/context_management/constants": typeof model_chat_agent_context_management_constants;
  "model/chat_agent/context_management/context_handler": typeof model_chat_agent_context_management_context_handler;
  "model/chat_agent/context_management/context_priority": typeof model_chat_agent_context_management_context_priority;
  "model/chat_agent/context_management/estimate_context_size": typeof model_chat_agent_context_management_estimate_context_size;
  "model/chat_agent/context_management/estimate_tokens": typeof model_chat_agent_context_management_estimate_tokens;
  "model/chat_agent/context_management/index": typeof model_chat_agent_context_management_index;
  "model/chat_agent/generate_agent_response": typeof model_chat_agent_generate_agent_response;
  "model/chat_agent/index": typeof model_chat_agent_index;
  "model/chat_agent/message_deduplication": typeof model_chat_agent_message_deduplication;
  "model/chat_agent/on_chat_complete": typeof model_chat_agent_on_chat_complete;
  "model/common/validators": typeof model_common_validators;
  "model/conversations/add_message_to_conversation": typeof model_conversations_add_message_to_conversation;
  "model/conversations/bulk_close_conversations": typeof model_conversations_bulk_close_conversations;
  "model/conversations/bulk_reopen_conversations": typeof model_conversations_bulk_reopen_conversations;
  "model/conversations/close_conversation": typeof model_conversations_close_conversation;
  "model/conversations/create_conversation": typeof model_conversations_create_conversation;
  "model/conversations/create_conversation_public": typeof model_conversations_create_conversation_public;
  "model/conversations/create_conversation_with_message": typeof model_conversations_create_conversation_with_message;
  "model/conversations/delete_conversation": typeof model_conversations_delete_conversation;
  "model/conversations/get_conversation_by_external_message_id": typeof model_conversations_get_conversation_by_external_message_id;
  "model/conversations/get_conversation_by_id": typeof model_conversations_get_conversation_by_id;
  "model/conversations/get_conversation_with_messages": typeof model_conversations_get_conversation_with_messages;
  "model/conversations/get_conversations": typeof model_conversations_get_conversations;
  "model/conversations/get_conversations_page": typeof model_conversations_get_conversations_page;
  "model/conversations/get_message_by_external_id": typeof model_conversations_get_message_by_external_id;
  "model/conversations/index": typeof model_conversations_index;
  "model/conversations/mark_conversation_as_read": typeof model_conversations_mark_conversation_as_read;
  "model/conversations/mark_conversation_as_spam": typeof model_conversations_mark_conversation_as_spam;
  "model/conversations/query_conversation_messages": typeof model_conversations_query_conversation_messages;
  "model/conversations/query_conversations": typeof model_conversations_query_conversations;
  "model/conversations/query_latest_message_by_delivery_state": typeof model_conversations_query_latest_message_by_delivery_state;
  "model/conversations/reopen_conversation": typeof model_conversations_reopen_conversation;
  "model/conversations/send_message_via_email": typeof model_conversations_send_message_via_email;
  "model/conversations/transform_conversation": typeof model_conversations_transform_conversation;
  "model/conversations/types": typeof model_conversations_types;
  "model/conversations/update_conversation": typeof model_conversations_update_conversation;
  "model/conversations/update_conversation_message": typeof model_conversations_update_conversation_message;
  "model/conversations/update_conversations": typeof model_conversations_update_conversations;
  "model/conversations/validators": typeof model_conversations_validators;
  "model/customers/bulk_create_customers": typeof model_customers_bulk_create_customers;
  "model/customers/create_customer": typeof model_customers_create_customer;
  "model/customers/create_customer_public": typeof model_customers_create_customer_public;
  "model/customers/delete_customer": typeof model_customers_delete_customer;
  "model/customers/filter_customers": typeof model_customers_filter_customers;
  "model/customers/find_or_create_customer": typeof model_customers_find_or_create_customer;
  "model/customers/get_customer": typeof model_customers_get_customer;
  "model/customers/get_customer_by_email": typeof model_customers_get_customer_by_email;
  "model/customers/get_customer_by_external_id": typeof model_customers_get_customer_by_external_id;
  "model/customers/get_customer_by_id": typeof model_customers_get_customer_by_id;
  "model/customers/get_customers": typeof model_customers_get_customers;
  "model/customers/index": typeof model_customers_index;
  "model/customers/query_customers": typeof model_customers_query_customers;
  "model/customers/search_customers": typeof model_customers_search_customers;
  "model/customers/types": typeof model_customers_types;
  "model/customers/update_customer": typeof model_customers_update_customer;
  "model/customers/update_customer_metadata": typeof model_customers_update_customer_metadata;
  "model/customers/update_customers": typeof model_customers_update_customers;
  "model/customers/validators": typeof model_customers_validators;
  "model/documents/check_membership": typeof model_documents_check_membership;
  "model/documents/create_document": typeof model_documents_create_document;
  "model/documents/create_onedrive_sync_config": typeof model_documents_create_onedrive_sync_config;
  "model/documents/delete_document": typeof model_documents_delete_document;
  "model/documents/extract_extension": typeof model_documents_extract_extension;
  "model/documents/find_document_by_title": typeof model_documents_find_document_by_title;
  "model/documents/generate_document": typeof model_documents_generate_document;
  "model/documents/generate_document_helpers": typeof model_documents_generate_document_helpers;
  "model/documents/generate_docx": typeof model_documents_generate_docx;
  "model/documents/generate_docx_from_template": typeof model_documents_generate_docx_from_template;
  "model/documents/generate_pptx": typeof model_documents_generate_pptx;
  "model/documents/generate_signed_url": typeof model_documents_generate_signed_url;
  "model/documents/get_document_by_id": typeof model_documents_get_document_by_id;
  "model/documents/get_document_by_id_public": typeof model_documents_get_document_by_id_public;
  "model/documents/get_document_by_path": typeof model_documents_get_document_by_path;
  "model/documents/get_documents": typeof model_documents_get_documents;
  "model/documents/get_documents_cursor": typeof model_documents_get_documents_cursor;
  "model/documents/get_onedrive_sync_configs": typeof model_documents_get_onedrive_sync_configs;
  "model/documents/index": typeof model_documents_index;
  "model/documents/list_documents_by_extension": typeof model_documents_list_documents_by_extension;
  "model/documents/query_documents": typeof model_documents_query_documents;
  "model/documents/read_file_base64_from_storage": typeof model_documents_read_file_base64_from_storage;
  "model/documents/transform_to_document_item": typeof model_documents_transform_to_document_item;
  "model/documents/types": typeof model_documents_types;
  "model/documents/update_document": typeof model_documents_update_document;
  "model/documents/upload_base64_to_storage": typeof model_documents_upload_base64_to_storage;
  "model/documents/validators": typeof model_documents_validators;
  "model/email_providers/create_oauth2_provider_logic": typeof model_email_providers_create_oauth2_provider_logic;
  "model/email_providers/create_provider_internal": typeof model_email_providers_create_provider_internal;
  "model/email_providers/create_provider_logic": typeof model_email_providers_create_provider_logic;
  "model/email_providers/decrypt_and_refresh_oauth2": typeof model_email_providers_decrypt_and_refresh_oauth2;
  "model/email_providers/delete_provider": typeof model_email_providers_delete_provider;
  "model/email_providers/generate_oauth2_auth_url": typeof model_email_providers_generate_oauth2_auth_url;
  "model/email_providers/generate_oauth2_auth_url_logic": typeof model_email_providers_generate_oauth2_auth_url_logic;
  "model/email_providers/get_default_provider": typeof model_email_providers_get_default_provider;
  "model/email_providers/get_provider_by_id": typeof model_email_providers_get_provider_by_id;
  "model/email_providers/index": typeof model_email_providers_index;
  "model/email_providers/list_providers": typeof model_email_providers_list_providers;
  "model/email_providers/save_related_workflows": typeof model_email_providers_save_related_workflows;
  "model/email_providers/send_message_via_api": typeof model_email_providers_send_message_via_api;
  "model/email_providers/send_message_via_smtp": typeof model_email_providers_send_message_via_smtp;
  "model/email_providers/store_oauth2_tokens_logic": typeof model_email_providers_store_oauth2_tokens_logic;
  "model/email_providers/test_connection_types": typeof model_email_providers_test_connection_types;
  "model/email_providers/test_existing_provider": typeof model_email_providers_test_existing_provider;
  "model/email_providers/test_existing_provider_logic": typeof model_email_providers_test_existing_provider_logic;
  "model/email_providers/test_imap_connection_logic": typeof model_email_providers_test_imap_connection_logic;
  "model/email_providers/test_new_provider_connection_logic": typeof model_email_providers_test_new_provider_connection_logic;
  "model/email_providers/test_smtp_connection_logic": typeof model_email_providers_test_smtp_connection_logic;
  "model/email_providers/types": typeof model_email_providers_types;
  "model/email_providers/update_metadata_internal": typeof model_email_providers_update_metadata_internal;
  "model/email_providers/update_oauth2_tokens": typeof model_email_providers_update_oauth2_tokens;
  "model/email_providers/update_provider": typeof model_email_providers_update_provider;
  "model/email_providers/update_provider_status": typeof model_email_providers_update_provider_status;
  "model/email_providers/validators": typeof model_email_providers_validators;
  "model/integrations/create_integration_internal": typeof model_integrations_create_integration_internal;
  "model/integrations/create_integration_logic": typeof model_integrations_create_integration_logic;
  "model/integrations/delete_integration": typeof model_integrations_delete_integration;
  "model/integrations/encrypt_credentials": typeof model_integrations_encrypt_credentials;
  "model/integrations/get_decrypted_credentials": typeof model_integrations_get_decrypted_credentials;
  "model/integrations/get_integration": typeof model_integrations_get_integration;
  "model/integrations/get_integration_by_name": typeof model_integrations_get_integration_by_name;
  "model/integrations/get_workflows_for_integration": typeof model_integrations_get_workflows_for_integration;
  "model/integrations/guards/is_rest_api_integration": typeof model_integrations_guards_is_rest_api_integration;
  "model/integrations/guards/is_sql_integration": typeof model_integrations_guards_is_sql_integration;
  "model/integrations/index": typeof model_integrations_index;
  "model/integrations/list_integrations": typeof model_integrations_list_integrations;
  "model/integrations/run_health_check": typeof model_integrations_run_health_check;
  "model/integrations/save_related_workflows": typeof model_integrations_save_related_workflows;
  "model/integrations/test_circuly_connection": typeof model_integrations_test_circuly_connection;
  "model/integrations/test_connection_logic": typeof model_integrations_test_connection_logic;
  "model/integrations/test_shopify_connection": typeof model_integrations_test_shopify_connection;
  "model/integrations/types": typeof model_integrations_types;
  "model/integrations/update_integration_internal": typeof model_integrations_update_integration_internal;
  "model/integrations/update_integration_logic": typeof model_integrations_update_integration_logic;
  "model/integrations/update_sync_stats": typeof model_integrations_update_sync_stats;
  "model/integrations/utils/get_integration_type": typeof model_integrations_utils_get_integration_type;
  "model/integrations/validators": typeof model_integrations_validators;
  "model/members/index": typeof model_members_index;
  "model/members/types": typeof model_members_types;
  "model/members/validators": typeof model_members_validators;
  "model/onedrive/create_sync_configs_logic": typeof model_onedrive_create_sync_configs_logic;
  "model/onedrive/get_user_token_logic": typeof model_onedrive_get_user_token_logic;
  "model/onedrive/index": typeof model_onedrive_index;
  "model/onedrive/list_folder_contents_logic": typeof model_onedrive_list_folder_contents_logic;
  "model/onedrive/read_file_logic": typeof model_onedrive_read_file_logic;
  "model/onedrive/refresh_token_logic": typeof model_onedrive_refresh_token_logic;
  "model/onedrive/update_sync_config_logic": typeof model_onedrive_update_sync_config_logic;
  "model/onedrive/upload_and_create_document_logic": typeof model_onedrive_upload_and_create_document_logic;
  "model/onedrive/upload_to_storage_logic": typeof model_onedrive_upload_to_storage_logic;
  "model/onedrive/validators": typeof model_onedrive_validators;
  "model/organizations/create_organization": typeof model_organizations_create_organization;
  "model/organizations/delete_organization": typeof model_organizations_delete_organization;
  "model/organizations/delete_organization_logo": typeof model_organizations_delete_organization_logo;
  "model/organizations/get_current_organization": typeof model_organizations_get_current_organization;
  "model/organizations/get_organization": typeof model_organizations_get_organization;
  "model/organizations/index": typeof model_organizations_index;
  "model/organizations/save_default_workflows": typeof model_organizations_save_default_workflows;
  "model/organizations/types": typeof model_organizations_types;
  "model/organizations/update_organization": typeof model_organizations_update_organization;
  "model/organizations/validators": typeof model_organizations_validators;
  "model/products/create_product": typeof model_products_create_product;
  "model/products/create_product_public": typeof model_products_create_product_public;
  "model/products/delete_product": typeof model_products_delete_product;
  "model/products/filter_products": typeof model_products_filter_products;
  "model/products/get_product": typeof model_products_get_product;
  "model/products/get_product_by_id": typeof model_products_get_product_by_id;
  "model/products/get_products": typeof model_products_get_products;
  "model/products/get_products_cursor": typeof model_products_get_products_cursor;
  "model/products/index": typeof model_products_index;
  "model/products/list_by_organization": typeof model_products_list_by_organization;
  "model/products/query_products": typeof model_products_query_products;
  "model/products/search_products_by_metadata": typeof model_products_search_products_by_metadata;
  "model/products/types": typeof model_products_types;
  "model/products/update_product": typeof model_products_update_product;
  "model/products/update_products": typeof model_products_update_products;
  "model/products/upsert_product_translation": typeof model_products_upsert_product_translation;
  "model/products/validators": typeof model_products_validators;
  "model/threads/create_chat_thread": typeof model_threads_create_chat_thread;
  "model/threads/delete_chat_thread": typeof model_threads_delete_chat_thread;
  "model/threads/get_latest_thread_with_message_count": typeof model_threads_get_latest_thread_with_message_count;
  "model/threads/get_latest_tool_message": typeof model_threads_get_latest_tool_message;
  "model/threads/get_or_create_sub_thread": typeof model_threads_get_or_create_sub_thread;
  "model/threads/get_thread_messages": typeof model_threads_get_thread_messages;
  "model/threads/get_thread_messages_streaming": typeof model_threads_get_thread_messages_streaming;
  "model/threads/index": typeof model_threads_index;
  "model/threads/list_threads": typeof model_threads_list_threads;
  "model/threads/update_chat_thread": typeof model_threads_update_chat_thread;
  "model/threads/validators": typeof model_threads_validators;
  "model/tone_of_voice/add_example_message": typeof model_tone_of_voice_add_example_message;
  "model/tone_of_voice/delete_example_message": typeof model_tone_of_voice_delete_example_message;
  "model/tone_of_voice/generate_tone_of_voice": typeof model_tone_of_voice_generate_tone_of_voice;
  "model/tone_of_voice/get_example_messages": typeof model_tone_of_voice_get_example_messages;
  "model/tone_of_voice/get_tone_of_voice": typeof model_tone_of_voice_get_tone_of_voice;
  "model/tone_of_voice/get_tone_of_voice_with_examples": typeof model_tone_of_voice_get_tone_of_voice_with_examples;
  "model/tone_of_voice/has_example_messages": typeof model_tone_of_voice_has_example_messages;
  "model/tone_of_voice/index": typeof model_tone_of_voice_index;
  "model/tone_of_voice/load_example_messages_for_generation": typeof model_tone_of_voice_load_example_messages_for_generation;
  "model/tone_of_voice/regenerate_tone_of_voice": typeof model_tone_of_voice_regenerate_tone_of_voice;
  "model/tone_of_voice/save_generated_tone": typeof model_tone_of_voice_save_generated_tone;
  "model/tone_of_voice/types": typeof model_tone_of_voice_types;
  "model/tone_of_voice/update_example_message": typeof model_tone_of_voice_update_example_message;
  "model/tone_of_voice/upsert_tone_of_voice": typeof model_tone_of_voice_upsert_tone_of_voice;
  "model/tone_of_voice/validators": typeof model_tone_of_voice_validators;
  "model/trusted_headers_authenticate/create_session_for_trusted_user": typeof model_trusted_headers_authenticate_create_session_for_trusted_user;
  "model/trusted_headers_authenticate/find_or_create_user_from_headers": typeof model_trusted_headers_authenticate_find_or_create_user_from_headers;
  "model/trusted_headers_authenticate/get_user_by_id": typeof model_trusted_headers_authenticate_get_user_by_id;
  "model/trusted_headers_authenticate/index": typeof model_trusted_headers_authenticate_index;
  "model/trusted_headers_authenticate/trusted_headers_authenticate": typeof model_trusted_headers_authenticate_trusted_headers_authenticate;
  "model/users/add_member_internal": typeof model_users_add_member_internal;
  "model/users/create_member": typeof model_users_create_member;
  "model/users/create_user_without_session": typeof model_users_create_user_without_session;
  "model/users/get_user_by_email": typeof model_users_get_user_by_email;
  "model/users/has_any_users": typeof model_users_has_any_users;
  "model/users/index": typeof model_users_index;
  "model/users/update_user_password": typeof model_users_update_user_password;
  "model/vendors/index": typeof model_vendors_index;
  "model/vendors/validators": typeof model_vendors_validators;
  "model/websites/bulk_create_websites": typeof model_websites_bulk_create_websites;
  "model/websites/bulk_upsert_pages": typeof model_websites_bulk_upsert_pages;
  "model/websites/create_website": typeof model_websites_create_website;
  "model/websites/delete_website": typeof model_websites_delete_website;
  "model/websites/get_page_by_url": typeof model_websites_get_page_by_url;
  "model/websites/get_pages_by_website": typeof model_websites_get_pages_by_website;
  "model/websites/get_website": typeof model_websites_get_website;
  "model/websites/get_website_by_domain": typeof model_websites_get_website_by_domain;
  "model/websites/get_websites": typeof model_websites_get_websites;
  "model/websites/index": typeof model_websites_index;
  "model/websites/provision_website_scan_workflow": typeof model_websites_provision_website_scan_workflow;
  "model/websites/rescan_website": typeof model_websites_rescan_website;
  "model/websites/search_websites": typeof model_websites_search_websites;
  "model/websites/types": typeof model_websites_types;
  "model/websites/update_website": typeof model_websites_update_website;
  "model/websites/validators": typeof model_websites_validators;
  "model/wf_definitions/activate_version": typeof model_wf_definitions_activate_version;
  "model/wf_definitions/create_draft_from_active": typeof model_wf_definitions_create_draft_from_active;
  "model/wf_definitions/create_workflow": typeof model_wf_definitions_create_workflow;
  "model/wf_definitions/create_workflow_draft": typeof model_wf_definitions_create_workflow_draft;
  "model/wf_definitions/create_workflow_with_steps": typeof model_wf_definitions_create_workflow_with_steps;
  "model/wf_definitions/delete_workflow": typeof model_wf_definitions_delete_workflow;
  "model/wf_definitions/duplicate_workflow": typeof model_wf_definitions_duplicate_workflow;
  "model/wf_definitions/get_active_version": typeof model_wf_definitions_get_active_version;
  "model/wf_definitions/get_automations_cursor": typeof model_wf_definitions_get_automations_cursor;
  "model/wf_definitions/get_draft": typeof model_wf_definitions_get_draft;
  "model/wf_definitions/get_version_by_number": typeof model_wf_definitions_get_version_by_number;
  "model/wf_definitions/get_workflow": typeof model_wf_definitions_get_workflow;
  "model/wf_definitions/get_workflow_by_name": typeof model_wf_definitions_get_workflow_by_name;
  "model/wf_definitions/get_workflow_with_first_step": typeof model_wf_definitions_get_workflow_with_first_step;
  "model/wf_definitions/index": typeof model_wf_definitions_index;
  "model/wf_definitions/list_versions": typeof model_wf_definitions_list_versions;
  "model/wf_definitions/list_workflows": typeof model_wf_definitions_list_workflows;
  "model/wf_definitions/list_workflows_with_best_version": typeof model_wf_definitions_list_workflows_with_best_version;
  "model/wf_definitions/publish_draft": typeof model_wf_definitions_publish_draft;
  "model/wf_definitions/save_manual_configuration": typeof model_wf_definitions_save_manual_configuration;
  "model/wf_definitions/save_workflow_with_steps": typeof model_wf_definitions_save_workflow_with_steps;
  "model/wf_definitions/types": typeof model_wf_definitions_types;
  "model/wf_definitions/update_draft": typeof model_wf_definitions_update_draft;
  "model/wf_definitions/update_workflow": typeof model_wf_definitions_update_workflow;
  "model/wf_definitions/update_workflow_status": typeof model_wf_definitions_update_workflow_status;
  "model/wf_definitions/validators": typeof model_wf_definitions_validators;
  "model/wf_executions/complete_execution": typeof model_wf_executions_complete_execution;
  "model/wf_executions/fail_execution": typeof model_wf_executions_fail_execution;
  "model/wf_executions/get_execution": typeof model_wf_executions_get_execution;
  "model/wf_executions/get_execution_step_journal": typeof model_wf_executions_get_execution_step_journal;
  "model/wf_executions/get_raw_execution": typeof model_wf_executions_get_raw_execution;
  "model/wf_executions/get_workflow_execution_stats": typeof model_wf_executions_get_workflow_execution_stats;
  "model/wf_executions/index": typeof model_wf_executions_index;
  "model/wf_executions/list_executions": typeof model_wf_executions_list_executions;
  "model/wf_executions/list_executions_cursor": typeof model_wf_executions_list_executions_cursor;
  "model/wf_executions/list_executions_paginated": typeof model_wf_executions_list_executions_paginated;
  "model/wf_executions/patch_execution": typeof model_wf_executions_patch_execution;
  "model/wf_executions/resume_execution": typeof model_wf_executions_resume_execution;
  "model/wf_executions/set_component_workflow": typeof model_wf_executions_set_component_workflow;
  "model/wf_executions/types": typeof model_wf_executions_types;
  "model/wf_executions/update_execution_metadata": typeof model_wf_executions_update_execution_metadata;
  "model/wf_executions/update_execution_status": typeof model_wf_executions_update_execution_status;
  "model/wf_executions/update_execution_variables": typeof model_wf_executions_update_execution_variables;
  "model/wf_executions/validators": typeof model_wf_executions_validators;
  "model/wf_step_defs/create_step": typeof model_wf_step_defs_create_step;
  "model/wf_step_defs/delete_step": typeof model_wf_step_defs_delete_step;
  "model/wf_step_defs/get_next_step_in_sequence": typeof model_wf_step_defs_get_next_step_in_sequence;
  "model/wf_step_defs/get_ordered_steps": typeof model_wf_step_defs_get_ordered_steps;
  "model/wf_step_defs/get_step_by_order": typeof model_wf_step_defs_get_step_by_order;
  "model/wf_step_defs/get_step_definition": typeof model_wf_step_defs_get_step_definition;
  "model/wf_step_defs/get_steps_by_type": typeof model_wf_step_defs_get_steps_by_type;
  "model/wf_step_defs/index": typeof model_wf_step_defs_index;
  "model/wf_step_defs/list_workflow_steps": typeof model_wf_step_defs_list_workflow_steps;
  "model/wf_step_defs/reorder_steps": typeof model_wf_step_defs_reorder_steps;
  "model/wf_step_defs/types": typeof model_wf_step_defs_types;
  "model/wf_step_defs/update_step": typeof model_wf_step_defs_update_step;
  "model/wf_step_defs/validators": typeof model_wf_step_defs_validators;
  "model/workflow_processing_records/ast_helpers/extract_comparison": typeof model_workflow_processing_records_ast_helpers_extract_comparison;
  "model/workflow_processing_records/ast_helpers/extract_literal_value": typeof model_workflow_processing_records_ast_helpers_extract_literal_value;
  "model/workflow_processing_records/ast_helpers/get_full_field_path": typeof model_workflow_processing_records_ast_helpers_get_full_field_path;
  "model/workflow_processing_records/ast_helpers/index": typeof model_workflow_processing_records_ast_helpers_index;
  "model/workflow_processing_records/ast_helpers/is_simple_field": typeof model_workflow_processing_records_ast_helpers_is_simple_field;
  "model/workflow_processing_records/ast_helpers/merge_and_conditions": typeof model_workflow_processing_records_ast_helpers_merge_and_conditions;
  "model/workflow_processing_records/ast_helpers/traverse_ast": typeof model_workflow_processing_records_ast_helpers_traverse_ast;
  "model/workflow_processing_records/ast_helpers/types": typeof model_workflow_processing_records_ast_helpers_types;
  "model/workflow_processing_records/calculate_cutoff_timestamp": typeof model_workflow_processing_records_calculate_cutoff_timestamp;
  "model/workflow_processing_records/constants": typeof model_workflow_processing_records_constants;
  "model/workflow_processing_records/find_and_claim_unprocessed": typeof model_workflow_processing_records_find_and_claim_unprocessed;
  "model/workflow_processing_records/get_latest_processed_creation_time": typeof model_workflow_processing_records_get_latest_processed_creation_time;
  "model/workflow_processing_records/get_processing_record_by_id": typeof model_workflow_processing_records_get_processing_record_by_id;
  "model/workflow_processing_records/get_table_indexes": typeof model_workflow_processing_records_get_table_indexes;
  "model/workflow_processing_records/index": typeof model_workflow_processing_records_index;
  "model/workflow_processing_records/index_selection/group_conditions_by_field": typeof model_workflow_processing_records_index_selection_group_conditions_by_field;
  "model/workflow_processing_records/index_selection/index": typeof model_workflow_processing_records_index_selection_index;
  "model/workflow_processing_records/index_selection/score_index": typeof model_workflow_processing_records_index_selection_score_index;
  "model/workflow_processing_records/index_selection/select_optimal_index": typeof model_workflow_processing_records_index_selection_select_optimal_index;
  "model/workflow_processing_records/index_selection/types": typeof model_workflow_processing_records_index_selection_types;
  "model/workflow_processing_records/is_record_processed": typeof model_workflow_processing_records_is_record_processed;
  "model/workflow_processing_records/parse_filter_expression": typeof model_workflow_processing_records_parse_filter_expression;
  "model/workflow_processing_records/query_building/create_expression_filter": typeof model_workflow_processing_records_query_building_create_expression_filter;
  "model/workflow_processing_records/query_building/create_query_builder": typeof model_workflow_processing_records_query_building_create_query_builder;
  "model/workflow_processing_records/query_building/find_unprocessed": typeof model_workflow_processing_records_query_building_find_unprocessed;
  "model/workflow_processing_records/query_building/index": typeof model_workflow_processing_records_query_building_index;
  "model/workflow_processing_records/query_building/types": typeof model_workflow_processing_records_query_building_types;
  "model/workflow_processing_records/record_claimed": typeof model_workflow_processing_records_record_claimed;
  "model/workflow_processing_records/record_processed": typeof model_workflow_processing_records_record_processed;
  "model/workflow_processing_records/run_query": typeof model_workflow_processing_records_run_query;
  "model/workflow_processing_records/types": typeof model_workflow_processing_records_types;
  "node_only/documents/generate_excel_internal": typeof node_only_documents_generate_excel_internal;
  "node_only/email_providers/test_connection": typeof node_only_email_providers_test_connection;
  "node_only/gmail/send_email": typeof node_only_gmail_send_email;
  "node_only/imap/lib/addresses": typeof node_only_imap_lib_addresses;
  "node_only/imap/lib/build_email_message": typeof node_only_imap_lib_build_email_message;
  "node_only/imap/lib/collect_thread_message_ids": typeof node_only_imap_lib_collect_thread_message_ids;
  "node_only/imap/lib/compute_uids_to_fetch": typeof node_only_imap_lib_compute_uids_to_fetch;
  "node_only/imap/lib/extract_thread_message_ids": typeof node_only_imap_lib_extract_thread_message_ids;
  "node_only/imap/lib/fetch_and_parse_message": typeof node_only_imap_lib_fetch_and_parse_message;
  "node_only/imap/lib/fetch_email_by_uid": typeof node_only_imap_lib_fetch_email_by_uid;
  "node_only/imap/lib/fetch_messages_from_search_results": typeof node_only_imap_lib_fetch_messages_from_search_results;
  "node_only/imap/lib/find_message_in_folders": typeof node_only_imap_lib_find_message_in_folders;
  "node_only/imap/lib/find_replies_to_message": typeof node_only_imap_lib_find_replies_to_message;
  "node_only/imap/lib/find_root_message": typeof node_only_imap_lib_find_root_message;
  "node_only/imap/lib/list_all_folders": typeof node_only_imap_lib_list_all_folders;
  "node_only/imap/lib/normalize_message_id": typeof node_only_imap_lib_normalize_message_id;
  "node_only/imap/lib/normalize_message_id_for_search": typeof node_only_imap_lib_normalize_message_id_for_search;
  "node_only/imap/lib/parse_headers": typeof node_only_imap_lib_parse_headers;
  "node_only/imap/lib/search_in_folder": typeof node_only_imap_lib_search_in_folder;
  "node_only/imap/lib/search_thread_messages": typeof node_only_imap_lib_search_thread_messages;
  "node_only/imap/retrieve_imap_emails": typeof node_only_imap_retrieve_imap_emails;
  "node_only/integration_sandbox/execute_integration_internal": typeof node_only_integration_sandbox_execute_integration_internal;
  "node_only/integration_sandbox/helpers/base64_decode": typeof node_only_integration_sandbox_helpers_base64_decode;
  "node_only/integration_sandbox/helpers/base64_encode": typeof node_only_integration_sandbox_helpers_base64_encode;
  "node_only/integration_sandbox/helpers/create_http_api": typeof node_only_integration_sandbox_helpers_create_http_api;
  "node_only/integration_sandbox/helpers/create_sandbox": typeof node_only_integration_sandbox_helpers_create_sandbox;
  "node_only/integration_sandbox/helpers/create_secrets_api": typeof node_only_integration_sandbox_helpers_create_secrets_api;
  "node_only/integration_sandbox/helpers/execute_http_request": typeof node_only_integration_sandbox_helpers_execute_http_request;
  "node_only/integration_sandbox/helpers/index": typeof node_only_integration_sandbox_helpers_index;
  "node_only/integration_sandbox/types": typeof node_only_integration_sandbox_types;
  "node_only/microsoft_graph/send_email": typeof node_only_microsoft_graph_send_email;
  "node_only/smtp/send_email": typeof node_only_smtp_send_email;
  "node_only/sql/execute_query_internal": typeof node_only_sql_execute_query_internal;
  "node_only/sql/helpers/execute_mssql_query": typeof node_only_sql_helpers_execute_mssql_query;
  "node_only/sql/helpers/execute_mysql_query": typeof node_only_sql_helpers_execute_mysql_query;
  "node_only/sql/helpers/execute_postgres_query": typeof node_only_sql_helpers_execute_postgres_query;
  "node_only/sql/helpers/execute_query": typeof node_only_sql_helpers_execute_query;
  "node_only/sql/helpers/validate_query": typeof node_only_sql_helpers_validate_query;
  "node_only/sql/types": typeof node_only_sql_types;
  oauth2: typeof oauth2;
  onedrive: typeof onedrive;
  organizations: typeof organizations;
  "predefined_integrations/circuly": typeof predefined_integrations_circuly;
  "predefined_integrations/index": typeof predefined_integrations_index;
  "predefined_integrations/protel": typeof predefined_integrations_protel;
  "predefined_integrations/shopify": typeof predefined_integrations_shopify;
  "predefined_integrations/types": typeof predefined_integrations_types;
  "predefined_workflows/circuly_sync_customers": typeof predefined_workflows_circuly_sync_customers;
  "predefined_workflows/circuly_sync_products": typeof predefined_workflows_circuly_sync_products;
  "predefined_workflows/circuly_sync_subscriptions": typeof predefined_workflows_circuly_sync_subscriptions;
  "predefined_workflows/conversation_auto_archive": typeof predefined_workflows_conversation_auto_archive;
  "predefined_workflows/conversation_auto_reply": typeof predefined_workflows_conversation_auto_reply;
  "predefined_workflows/customer_rag_sync": typeof predefined_workflows_customer_rag_sync;
  "predefined_workflows/document_rag_sync": typeof predefined_workflows_document_rag_sync;
  "predefined_workflows/email_sync_imap": typeof predefined_workflows_email_sync_imap;
  "predefined_workflows/email_sync_sent_imap": typeof predefined_workflows_email_sync_sent_imap;
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
  products: typeof products;
  streaming: typeof streaming;
  threads: typeof threads;
  tone_of_voice: typeof tone_of_voice;
  trusted_headers_authenticate: typeof trusted_headers_authenticate;
  users: typeof users;
  vendors: typeof vendors;
  websites: typeof websites;
  wf_definitions: typeof wf_definitions;
  wf_executions: typeof wf_executions;
  wf_step_defs: typeof wf_step_defs;
  "workflow/actions/action_registry": typeof workflow_actions_action_registry;
  "workflow/actions/approval/approval_action": typeof workflow_actions_approval_approval_action;
  "workflow/actions/approval/helpers/create_approval": typeof workflow_actions_approval_helpers_create_approval;
  "workflow/actions/approval/helpers/types": typeof workflow_actions_approval_helpers_types;
  "workflow/actions/conversation/conversation_action": typeof workflow_actions_conversation_conversation_action;
  "workflow/actions/conversation/helpers/add_message_to_conversation": typeof workflow_actions_conversation_helpers_add_message_to_conversation;
  "workflow/actions/conversation/helpers/build_conversation_metadata": typeof workflow_actions_conversation_helpers_build_conversation_metadata;
  "workflow/actions/conversation/helpers/build_email_metadata": typeof workflow_actions_conversation_helpers_build_email_metadata;
  "workflow/actions/conversation/helpers/build_initial_message": typeof workflow_actions_conversation_helpers_build_initial_message;
  "workflow/actions/conversation/helpers/check_conversation_exists": typeof workflow_actions_conversation_helpers_check_conversation_exists;
  "workflow/actions/conversation/helpers/check_message_exists": typeof workflow_actions_conversation_helpers_check_message_exists;
  "workflow/actions/conversation/helpers/create_conversation": typeof workflow_actions_conversation_helpers_create_conversation;
  "workflow/actions/conversation/helpers/create_conversation_from_email": typeof workflow_actions_conversation_helpers_create_conversation_from_email;
  "workflow/actions/conversation/helpers/create_conversation_from_sent_email": typeof workflow_actions_conversation_helpers_create_conversation_from_sent_email;
  "workflow/actions/conversation/helpers/find_or_create_customer_from_email": typeof workflow_actions_conversation_helpers_find_or_create_customer_from_email;
  "workflow/actions/conversation/helpers/find_related_conversation": typeof workflow_actions_conversation_helpers_find_related_conversation;
  "workflow/actions/conversation/helpers/query_conversation_messages": typeof workflow_actions_conversation_helpers_query_conversation_messages;
  "workflow/actions/conversation/helpers/query_latest_message_by_delivery_state": typeof workflow_actions_conversation_helpers_query_latest_message_by_delivery_state;
  "workflow/actions/conversation/helpers/types": typeof workflow_actions_conversation_helpers_types;
  "workflow/actions/conversation/helpers/update_conversations": typeof workflow_actions_conversation_helpers_update_conversations;
  "workflow/actions/conversation/helpers/update_message": typeof workflow_actions_conversation_helpers_update_message;
  "workflow/actions/crawler/crawler_action": typeof workflow_actions_crawler_crawler_action;
  "workflow/actions/crawler/helpers/types": typeof workflow_actions_crawler_helpers_types;
  "workflow/actions/customer/customer_action": typeof workflow_actions_customer_customer_action;
  "workflow/actions/document/document_action": typeof workflow_actions_document_document_action;
  "workflow/actions/email_provider/email_provider_action": typeof workflow_actions_email_provider_email_provider_action;
  "workflow/actions/imap/helpers/get_imap_credentials": typeof workflow_actions_imap_helpers_get_imap_credentials;
  "workflow/actions/imap/helpers/types": typeof workflow_actions_imap_helpers_types;
  "workflow/actions/imap/imap_action": typeof workflow_actions_imap_imap_action;
  "workflow/actions/integration/helpers/build_secrets_from_integration": typeof workflow_actions_integration_helpers_build_secrets_from_integration;
  "workflow/actions/integration/helpers/decrypt_sql_credentials": typeof workflow_actions_integration_helpers_decrypt_sql_credentials;
  "workflow/actions/integration/helpers/detect_write_operation": typeof workflow_actions_integration_helpers_detect_write_operation;
  "workflow/actions/integration/helpers/execute_sql_integration": typeof workflow_actions_integration_helpers_execute_sql_integration;
  "workflow/actions/integration/helpers/get_introspect_columns_query": typeof workflow_actions_integration_helpers_get_introspect_columns_query;
  "workflow/actions/integration/helpers/get_introspect_tables_query": typeof workflow_actions_integration_helpers_get_introspect_tables_query;
  "workflow/actions/integration/helpers/get_introspection_operations": typeof workflow_actions_integration_helpers_get_introspection_operations;
  "workflow/actions/integration/helpers/is_introspection_operation": typeof workflow_actions_integration_helpers_is_introspection_operation;
  "workflow/actions/integration/helpers/validate_required_parameters": typeof workflow_actions_integration_helpers_validate_required_parameters;
  "workflow/actions/integration/integration_action": typeof workflow_actions_integration_integration_action;
  "workflow/actions/onedrive/onedrive_action": typeof workflow_actions_onedrive_onedrive_action;
  "workflow/actions/product/product_action": typeof workflow_actions_product_product_action;
  "workflow/actions/rag/helpers/delete_document": typeof workflow_actions_rag_helpers_delete_document;
  "workflow/actions/rag/helpers/get_document_info": typeof workflow_actions_rag_helpers_get_document_info;
  "workflow/actions/rag/helpers/get_rag_config": typeof workflow_actions_rag_helpers_get_rag_config;
  "workflow/actions/rag/helpers/types": typeof workflow_actions_rag_helpers_types;
  "workflow/actions/rag/helpers/upload_file_direct": typeof workflow_actions_rag_helpers_upload_file_direct;
  "workflow/actions/rag/helpers/upload_text_document": typeof workflow_actions_rag_helpers_upload_text_document;
  "workflow/actions/rag/rag_action": typeof workflow_actions_rag_rag_action;
  "workflow/actions/set_variables_action": typeof workflow_actions_set_variables_action;
  "workflow/actions/tone_of_voice/tone_of_voice_action": typeof workflow_actions_tone_of_voice_tone_of_voice_action;
  "workflow/actions/website/helpers/types": typeof workflow_actions_website_helpers_types;
  "workflow/actions/website/website_action": typeof workflow_actions_website_website_action;
  "workflow/actions/websitePages/helpers/types": typeof workflow_actions_websitePages_helpers_types;
  "workflow/actions/websitePages/websitePages_action": typeof workflow_actions_websitePages_websitePages_action;
  "workflow/actions/workflow/helpers/types": typeof workflow_actions_workflow_helpers_types;
  "workflow/actions/workflow/helpers/upload_workflows": typeof workflow_actions_workflow_helpers_upload_workflows;
  "workflow/actions/workflow/workflow_action": typeof workflow_actions_workflow_workflow_action;
  "workflow/actions/workflow_processing_records/helpers/find_unprocessed": typeof workflow_actions_workflow_processing_records_helpers_find_unprocessed;
  "workflow/actions/workflow_processing_records/helpers/record_processed": typeof workflow_actions_workflow_processing_records_helpers_record_processed;
  "workflow/actions/workflow_processing_records/helpers/types": typeof workflow_actions_workflow_processing_records_helpers_types;
  "workflow/actions/workflow_processing_records/workflow_processing_records_action": typeof workflow_actions_workflow_processing_records_workflow_processing_records_action;
  "workflow/engine": typeof workflow_engine;
  "workflow/helpers/data_source/database_workflow_data_source": typeof workflow_helpers_data_source_database_workflow_data_source;
  "workflow/helpers/data_source/types": typeof workflow_helpers_data_source_types;
  "workflow/helpers/engine/build_steps_config_map": typeof workflow_helpers_engine_build_steps_config_map;
  "workflow/helpers/engine/cleanup_component_workflow": typeof workflow_helpers_engine_cleanup_component_workflow;
  "workflow/helpers/engine/dynamic_workflow_handler": typeof workflow_helpers_engine_dynamic_workflow_handler;
  "workflow/helpers/engine/execute_step_handler": typeof workflow_helpers_engine_execute_step_handler;
  "workflow/helpers/engine/execute_workflow_start": typeof workflow_helpers_engine_execute_workflow_start;
  "workflow/helpers/engine/index": typeof workflow_helpers_engine_index;
  "workflow/helpers/engine/load_database_workflow": typeof workflow_helpers_engine_load_database_workflow;
  "workflow/helpers/engine/mark_execution_completed_handler": typeof workflow_helpers_engine_mark_execution_completed_handler;
  "workflow/helpers/engine/on_workflow_complete": typeof workflow_helpers_engine_on_workflow_complete;
  "workflow/helpers/engine/start_workflow_handler": typeof workflow_helpers_engine_start_workflow_handler;
  "workflow/helpers/engine/workflow_data": typeof workflow_helpers_engine_workflow_data;
  "workflow/helpers/formatting/stringify": typeof workflow_helpers_formatting_stringify;
  "workflow/helpers/nodes/action/execute_action_node": typeof workflow_helpers_nodes_action_execute_action_node;
  "workflow/helpers/nodes/action/get_action": typeof workflow_helpers_nodes_action_get_action;
  "workflow/helpers/nodes/action/list_actions": typeof workflow_helpers_nodes_action_list_actions;
  "workflow/helpers/nodes/action/types": typeof workflow_helpers_nodes_action_types;
  "workflow/helpers/nodes/condition/execute_condition_node": typeof workflow_helpers_nodes_condition_execute_condition_node;
  "workflow/helpers/nodes/constants": typeof workflow_helpers_nodes_constants;
  "workflow/helpers/nodes/llm/execute_agent_with_tools": typeof workflow_helpers_nodes_llm_execute_agent_with_tools;
  "workflow/helpers/nodes/llm/execute_llm_node": typeof workflow_helpers_nodes_llm_execute_llm_node;
  "workflow/helpers/nodes/llm/extract_json_from_text": typeof workflow_helpers_nodes_llm_extract_json_from_text;
  "workflow/helpers/nodes/llm/types": typeof workflow_helpers_nodes_llm_types;
  "workflow/helpers/nodes/llm/types/workflow_termination": typeof workflow_helpers_nodes_llm_types_workflow_termination;
  "workflow/helpers/nodes/llm/utils/build_agent_steps_summary": typeof workflow_helpers_nodes_llm_utils_build_agent_steps_summary;
  "workflow/helpers/nodes/llm/utils/create_llm_result": typeof workflow_helpers_nodes_llm_utils_create_llm_result;
  "workflow/helpers/nodes/llm/utils/extract_tool_diagnostics": typeof workflow_helpers_nodes_llm_utils_extract_tool_diagnostics;
  "workflow/helpers/nodes/llm/utils/process_agent_result": typeof workflow_helpers_nodes_llm_utils_process_agent_result;
  "workflow/helpers/nodes/llm/utils/process_prompts": typeof workflow_helpers_nodes_llm_utils_process_prompts;
  "workflow/helpers/nodes/llm/utils/validate_and_normalize_config": typeof workflow_helpers_nodes_llm_utils_validate_and_normalize_config;
  "workflow/helpers/nodes/loop/execute_loop_node": typeof workflow_helpers_nodes_loop_execute_loop_node;
  "workflow/helpers/nodes/loop/loop_node_executor": typeof workflow_helpers_nodes_loop_loop_node_executor;
  "workflow/helpers/nodes/loop/utils/create_loop_result": typeof workflow_helpers_nodes_loop_utils_create_loop_result;
  "workflow/helpers/nodes/loop/utils/create_loop_state": typeof workflow_helpers_nodes_loop_utils_create_loop_state;
  "workflow/helpers/nodes/loop/utils/get_input_data": typeof workflow_helpers_nodes_loop_utils_get_input_data;
  "workflow/helpers/nodes/loop/utils/get_loop_items": typeof workflow_helpers_nodes_loop_utils_get_loop_items;
  "workflow/helpers/nodes/loop/utils/is_loop_in_progress": typeof workflow_helpers_nodes_loop_utils_is_loop_in_progress;
  "workflow/helpers/nodes/trigger/execute_trigger_node": typeof workflow_helpers_nodes_trigger_execute_trigger_node;
  "workflow/helpers/nodes/trigger/process_trigger_config": typeof workflow_helpers_nodes_trigger_process_trigger_config;
  "workflow/helpers/scheduler/get_last_execution_time": typeof workflow_helpers_scheduler_get_last_execution_time;
  "workflow/helpers/scheduler/get_scheduled_workflows": typeof workflow_helpers_scheduler_get_scheduled_workflows;
  "workflow/helpers/scheduler/index": typeof workflow_helpers_scheduler_index;
  "workflow/helpers/scheduler/scan_and_trigger": typeof workflow_helpers_scheduler_scan_and_trigger;
  "workflow/helpers/scheduler/should_trigger_workflow": typeof workflow_helpers_scheduler_should_trigger_workflow;
  "workflow/helpers/scheduler/trigger_workflow_by_id": typeof workflow_helpers_scheduler_trigger_workflow_by_id;
  "workflow/helpers/serialization/deserialize_variables": typeof workflow_helpers_serialization_deserialize_variables;
  "workflow/helpers/serialization/serialize_variables": typeof workflow_helpers_serialization_serialize_variables;
  "workflow/helpers/step_execution/build_steps_map": typeof workflow_helpers_step_execution_build_steps_map;
  "workflow/helpers/step_execution/decrypt_and_merge_secrets": typeof workflow_helpers_step_execution_decrypt_and_merge_secrets;
  "workflow/helpers/step_execution/execute_step_by_type": typeof workflow_helpers_step_execution_execute_step_by_type;
  "workflow/helpers/step_execution/extract_essential_loop_variables": typeof workflow_helpers_step_execution_extract_essential_loop_variables;
  "workflow/helpers/step_execution/extract_loop_variables": typeof workflow_helpers_step_execution_extract_loop_variables;
  "workflow/helpers/step_execution/extract_steps_with_outputs": typeof workflow_helpers_step_execution_extract_steps_with_outputs;
  "workflow/helpers/step_execution/initialize_execution_variables": typeof workflow_helpers_step_execution_initialize_execution_variables;
  "workflow/helpers/step_execution/load_and_validate_execution": typeof workflow_helpers_step_execution_load_and_validate_execution;
  "workflow/helpers/step_execution/merge_execution_variables": typeof workflow_helpers_step_execution_merge_execution_variables;
  "workflow/helpers/step_execution/persist_execution_result": typeof workflow_helpers_step_execution_persist_execution_result;
  "workflow/helpers/step_execution/types": typeof workflow_helpers_step_execution_types;
  "workflow/helpers/validation/constants": typeof workflow_helpers_validation_constants;
  "workflow/helpers/validation/index": typeof workflow_helpers_validation_index;
  "workflow/helpers/validation/steps/action": typeof workflow_helpers_validation_steps_action;
  "workflow/helpers/validation/steps/condition": typeof workflow_helpers_validation_steps_condition;
  "workflow/helpers/validation/steps/index": typeof workflow_helpers_validation_steps_index;
  "workflow/helpers/validation/steps/llm": typeof workflow_helpers_validation_steps_llm;
  "workflow/helpers/validation/steps/loop": typeof workflow_helpers_validation_steps_loop;
  "workflow/helpers/validation/steps/trigger": typeof workflow_helpers_validation_steps_trigger;
  "workflow/helpers/validation/types": typeof workflow_helpers_validation_types;
  "workflow/helpers/validation/validate_action_parameters": typeof workflow_helpers_validation_validate_action_parameters;
  "workflow/helpers/validation/validate_step_config": typeof workflow_helpers_validation_validate_step_config;
  "workflow/helpers/validation/validate_workflow_definition": typeof workflow_helpers_validation_validate_workflow_definition;
  "workflow/helpers/validation/validate_workflow_steps": typeof workflow_helpers_validation_validate_workflow_steps;
  "workflow/helpers/validation/variables/action_schemas": typeof workflow_helpers_validation_variables_action_schemas;
  "workflow/helpers/validation/variables/index": typeof workflow_helpers_validation_variables_index;
  "workflow/helpers/validation/variables/parse": typeof workflow_helpers_validation_variables_parse;
  "workflow/helpers/validation/variables/step_schemas": typeof workflow_helpers_validation_variables_step_schemas;
  "workflow/helpers/validation/variables/types": typeof workflow_helpers_validation_variables_types;
  "workflow/helpers/validation/variables/validate": typeof workflow_helpers_validation_variables_validate;
  "workflow/helpers/variables/decrypt_inline_secrets": typeof workflow_helpers_variables_decrypt_inline_secrets;
  "workflow/instructions/core_instructions": typeof workflow_instructions_core_instructions;
  "workflow/nodes": typeof workflow_nodes;
  "workflow/scheduler": typeof workflow_scheduler;
  "workflow/types/execution": typeof workflow_types_execution;
  "workflow/types/index": typeof workflow_types_index;
  "workflow/types/nodes": typeof workflow_types_nodes;
  "workflow/types/workflow": typeof workflow_types_workflow;
  "workflow/types/workflow_types": typeof workflow_types_workflow_types;
  "workflow/workflow_syntax_compact": typeof workflow_workflow_syntax_compact;
  workflow_assistant_agent: typeof workflow_assistant_agent;
  workflow_processing_records: typeof workflow_processing_records;
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
                  createdAt: number;
                  expiresAt: number;
                  ipAddress?: null | string;
                  token: string;
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
                  organizationId: string;
                  role: string;
                  userId: string;
                };
                model: "member";
              }
            | {
                data: {
                  email: string;
                  expiresAt: number;
                  inviterId: string;
                  organizationId: string;
                  role?: null | string;
                  status: string;
                };
                model: "invitation";
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
                  field: "publicKey" | "privateKey" | "createdAt" | "_id";
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
                    | "status"
                    | "expiresAt"
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
                  field: "publicKey" | "privateKey" | "createdAt" | "_id";
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
                    | "status"
                    | "expiresAt"
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
              };
          onDeleteHandle?: string;
        },
        any
      >;
      findMany: FunctionReference<
        "query",
        "internal",
        {
          limit?: number;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "jwks"
            | "organization"
            | "member"
            | "invitation";
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
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "jwks"
            | "organization"
            | "member"
            | "invitation";
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
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
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
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "publicKey" | "privateKey" | "createdAt" | "_id";
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
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
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
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
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
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "publicKey" | "privateKey" | "createdAt" | "_id";
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
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
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
