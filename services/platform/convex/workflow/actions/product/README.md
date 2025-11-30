# Product Action

Product-specific workflow actions for safe, specialized operations on product data.

## Operations

### 1. create
Create a new product.

**Required Parameters:**
- `organizationId`: Organization ID
- `name`: Product name

**Optional Parameters:**
- `description`: Product description
- `imageUrl`: Product image URL
- `stock`: Stock quantity
- `price`: Product price
- `currency`: Currency code
- `category`: Product category
- `tags`: Array of tags
- `status`: Product status (active, inactive, draft, archived)
- `externalId`: External system ID
- `metadata`: Additional metadata

**Example:**
```typescript
{
  operation: 'create',
  organizationId: 'org_123',
  name: 'Premium Laptop',
  price: 1299,
  status: 'active'
}
```

### 2. get_by_id
Get a product by its ID.

**Required Parameters:**
- `productId`: Product ID

**Example:**
```typescript
{
  operation: 'get_by_id',
  productId: 'prod_123'
}
```

### 3. query
Query products with pagination and filtering.

**Required Parameters:**
- `organizationId`: Organization ID
- `paginationOpts`: Pagination options
  - `numItems`: Number of items per page
  - `cursor`: Pagination cursor (null for first page)

**Optional Parameters:**
- `externalId`: Filter by external ID
- `status`: Filter by status
- `category`: Filter by category

**Example:**
```typescript
{
  operation: 'query',
  organizationId: 'org_123',
  status: 'active',
  paginationOpts: {
    numItems: 10,
    cursor: null
  }
}
```

### 4. update
Update products with flexible filtering.

**Required Parameters:**
- Either `productId` OR `organizationId`
- `updates`: Object containing fields to update

**Optional Parameters:**
- `externalId`: Filter by external ID
- `status`: Filter by status
- `category`: Filter by category

**Example:**
```typescript
{
  operation: 'update',
  productId: 'prod_123',
  updates: {
    price: 1499,
    status: 'active'
  }
}
```

### 5. filter
Filter products using JEXL expressions. This operation loops through all products in the organization and evaluates the expression against each product. Products that match (expression evaluates to true) are returned.

**Required Parameters:**
- `organizationId`: Organization ID
- `expression`: JEXL expression to evaluate

**How it works:**
1. Loops through all products using cursor-based iteration
2. Evaluates the JEXL expression with each product as context
3. Returns products where the expression evaluates to true

**Expression Context:**
The expression has access to all product fields:
- `_id`: Product ID
- `_creationTime`: Creation timestamp
- `organizationId`: Organization ID
- `name`: Product name
- `description`: Product description
- `imageUrl`: Product image URL
- `stock`: Stock quantity
- `price`: Product price
- `currency`: Currency code
- `category`: Product category
- `tags`: Array of tags
- `status`: Product status
- `externalId`: External system ID
- `metadata`: Additional metadata (can access nested fields)

**Examples:**

Filter by price:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'price > 100'
}
```

Filter by status:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'status == "active"'
}
```

Filter by multiple conditions:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'price > 50 && price < 200 && status == "active"'
}
```

Filter by metadata field:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'metadata.featured == true'
}
```

Filter by nested metadata:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'metadata.shopify && metadata.shopify.status == "active"'
}
```

Filter by tags (array contains):
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'tags && tags.includes("premium")'
}
```

Filter by stock availability:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: 'stock > 0 && stock < 10'
}
```

Complex filter with logical operators:
```typescript
{
  operation: 'filter',
  organizationId: 'org_123',
  expression: '(category == "Electronics" || category == "Furniture") && price > 100'
}
```

**Return Value:**
```typescript
{
  operation: 'filter',
  products: [...], // Array of matching products
  count: 5,        // Number of matching products
  timestamp: 1234567890
}
```

**Performance Notes:**
- Uses cursor-based iteration for efficient processing
- Processes products one at a time to avoid memory issues
- Continues processing even if one product fails evaluation
- Errors are logged but don't stop the entire operation

## JEXL Expression Syntax

The filter operation uses JEXL (JavaScript Expression Language) for safe expression evaluation. JEXL supports:

- **Comparisons**: `>`, `<`, `>=`, `<=`, `==`, `!=`
- **Logical operators**: `&&`, `||`, `!`
- **Math operations**: `+`, `-`, `*`, `/`, `%`
- **Ternary operator**: `condition ? true_value : false_value`
- **Array operations**: `array.includes(value)`, `array.length`
- **Object access**: `object.field`, `object.nested.field`
- **Null checks**: `field != null`, `field != undefined`

See the [JEXL documentation](../../../../../../lib/variables/DESIGN.md) for more details.

## Best Practices

1. **Use indexes when possible**: For simple queries, prefer the `query` operation which uses Convex indexes for better performance.

2. **Use filter for complex conditions**: Use the `filter` operation when you need to evaluate complex expressions that can't be expressed with simple index queries.

3. **Test expressions**: Test your JEXL expressions with a small dataset first to ensure they work as expected.

4. **Handle null values**: Always check for null/undefined when accessing optional fields:
   ```typescript
   expression: 'metadata && metadata.field == "value"'
   ```

5. **Use meaningful variable names**: Store filter results in workflow variables with descriptive names:
   ```typescript
   steps.filter_expensive_products.output.products
   ```

## See Also

- [JEXL Expression Guide](../../../../../../lib/variables/DESIGN.md)
- [Product Filter Example Workflow](../../../../../../workflows/examples/product-filter-example.ts)
- [Workflow Developer Guide](../../../../../../docs/workflows/developer-guide.md)

