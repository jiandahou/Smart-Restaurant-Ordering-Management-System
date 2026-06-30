# List API conventions

Administrative list endpoints use page-based pagination and the same core query parameters.

## Common parameters

| Parameter | Default | Rules |
| --- | --- | --- |
| `page` | `1` | Integer greater than zero. |
| `pageSize` | `20` | Integer from 1 through 100. |
| `search` | empty | Case-insensitive keyword, up to 200 characters. Searchable fields are endpoint-specific. |
| `sortBy` | endpoint-specific | Must be one of the endpoint's documented fields. |
| `sortDirection` | `desc` | `asc` or `desc`. |

Invalid values and unsupported sort fields return `400 Bad Request`. Filters are combined with AND. All sorts include an ID tie-breaker so page boundaries remain stable.

## Response

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "totalItems": 0,
  "totalPages": 0,
  "hasPreviousPage": false,
  "hasNextPage": false
}
```

## Admin orders

`GET /api/admin/orders`

Filters: `status`, `paymentStatus`, `orderType`, `restaurantId`, `payableOnly`.

Search fields: order number, restaurant name, customer name, customer email, table number, item name, and provider checkout/payment intent IDs.

Sort fields: `createdAt`, `updatedAt`, `orderNumber`, `restaurantName`, `status`, `paymentStatus`, `totalAmount`.

## Payments

`GET /api/payments`

Filters: `status`, `orderStatus`, `orderType`, `restaurantId`.

Search fields: payment ID, provider checkout/payment intent IDs, order number, restaurant name, customer name, and customer email.

Sort fields: `createdAt`, `updatedAt`, `orderNumber`, `restaurantName`, `status`, `amount`.

## Users

`GET /api/restaurant/users`

Filters: `role`, `restaurantId`, `scope` (`all`, `platform`, or `restaurant`).

Search fields: full name, email, and role name.

Sort fields: `fullName`, `email`, `restaurant`, `role`, `createdAt`, `updatedAt`.

Platform-owner variants `GET /api/users` and `GET /api/restaurants/{restaurantId}/users` use the same request and response conventions.

## Restaurants

`GET /api/restaurant`

Filters: `isActive`, `countryCode`, `currency`.

Search fields: name, address, phone, country code, timezone, and currency.

Sort fields: `name`, `address`, `currency`, `status`, `createdAt`, `updatedAt`.
