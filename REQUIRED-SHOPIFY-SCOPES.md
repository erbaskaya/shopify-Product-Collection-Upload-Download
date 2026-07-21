# Required custom app scopes

Enable these Admin API access scopes for every Shopify custom app token used by the desktop application:

- read_products, write_products
- read_inventory, write_inventory
- read_locations
- read_customers, write_customers
- read_orders, write_orders
- read_content, write_content
- read_discounts, write_discounts
- read_files, write_files

For order exports older than 60 days, request and enable `read_all_orders` where Shopify allows it.
After changing custom app scopes, install/update the app in the store and generate a new Admin API access token. Save the new token in Stores.
