You have to generate 3 datasets:

merchants - A merchant record represents a webshop that uses Recart.
subscribers - A subscriber record represents a person who subscribed to get marketing messages from a merchant using Recart.
orders - An order record represents a purchase made by a person.
Schemas:

merchants:

id - ObjectId or UUID, cannot be null, must be unique
domain - text, it has to be a valid URI, cannot be null, must be unique
subscribers:

id - ObjectId or UUID, cannot be null, must be unique
merchant_id - ObjectId or UUID, cannot be null, must be present in the merchants dataset
phone_number - text, must be a valid phone number, cannot be null, must be unique on a per-merchant basis
subscribed_at - timestamp, cannot be null
unsubscribed_at - timestamp, can be null
orders:

id - ObjectId or UUID, cannot be null, must be unique
merchant_id - ObjectId or UUID, cannot be null, must be present in the merchants dataset
subscriber_id - ObjectId or UUID, can be null, must be present in the subscribers dataset
email - text, must be a valid email address, cannot be null
phone_number - text, must be a valid phone number, can be null
created_at - timestamp, cannot be null
Other properties of the datasets:

There should be at least:

100 merchants
1 million subscribers
1.5 million orders
The amount of subscribers and orders has to be distributed over a 6-month-long time window.

At least 30% of the orders have to have a valid phone number, and there should be an overlap with the phone numbers in the subscribers dataset.

At least 5% of the subscribers have to have been unsubscribed in the last 6 months.