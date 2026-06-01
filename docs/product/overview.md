# Smart Restaurant Ordering & Management System

## 1. Project Background

This project is a full-stack restaurant ordering and management platform designed for small to medium-sized restaurants. The idea was inspired by real restaurant workflows observed by one of the team members who works in a restaurant.

The system aims to improve the ordering process by allowing customers to place orders through a digital menu, while restaurant staff can manage menus, track orders, process payments, and receive real-time notifications.

## 2. Problem Statement

Many small restaurants still rely on manual ordering processes, which can lead to:

- Customers need to verbally communicate special requirements to staff, such as allergies, dietary preferences, or modifications to dishes.
- Language barriers between customers and staff may cause misunderstanding or incorrect orders.
- Customers are usually unable to place orders in advance or schedule orders for a specific pickup or dining time.
- When some menu items are sold out, customers often need to wait for staff to inform them manually.
- Customers may feel rushed when ordering at the counter, instead of being able to sit down and review the menu at their own pace.
- Restaurants may not have an effective way to promote in-store discounts, limited-time offers, or recommended dishes to customers.
- Customers may not have easy access to their order history, making it harder to reorder previous meals or track past purchases.
- Restaurants may lack an integrated membership system to manage customer profiles, loyalty points, rewards, and repeat-customer benefits.
- Customers may not have a clear and convenient channel to request refunds or report issues with their orders.
- Restaurants may struggle to maintain customer engagement and notify users about new promotions, seasonal menus, or special events.
- Manual ordering during peak hours can lead to slow service, miscommunication, and extra workload for front-of-house staff.
- Restaurant staff may find it difficult to track order status, update menu availability, and manage customer requests efficiently.

## 3. Project Goals

The goal of this project is to build a practical restaurant ordering system that supports:

- QR-code based table ordering, allowing customers to sit down, browse the menu, and order at their own pace.
- Digital menu and category management, allowing restaurants to update dishes, prices, availability, and sold-out items in real time.
- Special request and dietary note support, allowing customers to clearly specify allergies, preferences, and dish modifications.
- Multi-language menu and ordering support, reducing communication issues caused by language barriers.
- Scheduled ordering, allowing customers to place orders in advance for a specific pickup or dining time.
- Order status tracking, allowing customers and staff to follow the progress of each order.
- Staff-side order processing, helping restaurant staff receive, manage, and update orders more efficiently.
- Admin dashboard, allowing restaurant owners or managers to manage menus, orders, staff accounts, promotions, and sales data.
- Promotion and campaign display, helping restaurants show discounts, limited-time offers, recommended dishes, and seasonal menus.
- Customer order history, allowing users to view past orders and quickly reorder previous meals.
- Membership and loyalty system integration, helping restaurants manage customer profiles, rewards, points, and repeat-customer benefits.
- Refund and issue-reporting channel, allowing customers to request refunds or report order problems more clearly.
- Real-time notifications, allowing staff to receive new order alerts and customers to receive updates about order status and restaurant promotions.
- Stripe payment integration, allowing customers to complete payments online and restaurants to process transactions more efficiently.
- AI-powered voice ordering, allowing customers to place orders using natural language and convert spoken requests into structured order data.

## 4. Target Users

### Customers

Customers can browse the digital menu, view promotions, check item availability, place orders, make payments, add special requests, and track order status.

They can also view their order history, reorder previous meals, request refunds or report issues, and receive notifications about new offers or restaurant updates.

### Dine-in Customers

Dine-in customers can scan a QR code at the table, sit down, review the menu at their own pace, and place orders without waiting for staff to take orders manually.

This helps reduce pressure during peak hours and improves the overall dining experience.

### Takeaway / Scheduled Order Customers

Takeaway customers can place orders in advance and schedule a specific pickup or dining time.

This allows customers to plan ahead and helps restaurants manage order preparation more efficiently.

### Restaurant Staff

Restaurant staff can receive and process incoming orders, view customer notes or special requests, update order status, manage sold-out items, and receive real-time notifications for new orders.

This helps reduce miscommunication, improve kitchen workflow, and lower front-of-house workload.

### Restaurant Admin / Owner

Restaurant admins or owners can manage menus, categories, prices, item availability, staff accounts, promotions, orders, refunds, customer memberships, and sales data.

They can also use the dashboard to understand restaurant performance, promote special offers, and improve customer engagement.

### Registered Members

Registered members can save their profile, view order history, earn or use loyalty rewards, receive personalized promotions, and reorder previous meals more conveniently.

## 5. Core Features

### Customer Side

- QR-code table ordering
- Digital menu browsing
- Menu search and category filtering
- Cart management
- Special requests and dietary notes
- Multi-language menu support
- Scheduled ordering for pickup or dining
- Online payment
- Order status tracking
- Order history and quick reorder
- Refund or issue-reporting request
- Promotion and discount viewing
- Membership and loyalty rewards
- Notifications for order updates and restaurant promotions

### Staff Side

- View incoming orders in real time
- Accept, reject, or update orders
- View customer notes, allergies, and special requests
- Update order status, such as pending, preparing, ready, completed, or cancelled
- Manage sold-out items and menu availability
- Receive real-time new order notifications
- Handle refund or issue reports
- Support kitchen workflow and order preparation

### Admin Side

- Menu and category management
- Price and item availability management
- Staff account and role management
- Order history management
- Sales dashboard and basic analytics
- Promotion and campaign management
- Membership and customer profile management
- Refund management
- Restaurant settings management

### AI Features

- Voice order input
- Speech-to-text conversion
- AI conversion from natural language to structured order data
- Multi-language order assistance
- Automatic recognition of quantities, dishes, modifiers, and special requests
- Order confirmation before submission

## 6. Tech Stack

### Frontend Web Application

React, TypeScript, Vite, Tailwind CSS, shadcn/ui

The customer ordering page, staff dashboard, and admin dashboard will be built as responsive web applications.

Customers can scan a QR code using iOS or Android devices. The QR code will open a web URL in the mobile browser, so users do not need to install an app for the MVP.

### Backend

.NET Core Web API

The backend will handle authentication, menu management, order processing, payment status, notifications, refund requests, membership data, and admin operations.

### Database

PostgreSQL

The database will store users, restaurants, menus, categories, orders, payments, promotions, memberships, refunds, and notification records.

### Real-time Communication

SignalR / WebSocket

Real-time communication will be used for new order alerts, order status updates, and staff-side notifications.

### Payment

Stripe Checkout and Stripe Webhook

Stripe will be used for online payment. Webhooks will update payment and order status after successful or failed transactions.

### AI Service

OpenAI API / local AI service in the future

The AI service will support voice ordering, natural language order parsing, multi-language assistance, and automatic extraction of dishes, quantities, modifiers, and special requests.

### Mobile Access

Responsive Web App / Progressive Web App

The first version will use a mobile-friendly web application that works on both iOS and Android through QR-code scanning.

In the future, the system can be extended into a mobile app using React Native, Expo, or a PWA installation experience.

### Deployment

Docker, AWS or Azure

The system can be containerized with Docker and deployed to cloud platforms such as AWS or Azure.

## 7. Architecture

The first version will use a modular monolith architecture. The backend will be divided into clear modules such as authentication, menu, order, payment, notification, and AI ordering.

This design allows the system to remain simple during early development while still supporting future migration to microservices.

## 8. MVP Scope

The MVP will focus on building a complete basic ordering workflow for a single restaurant.

The MVP will include:

- QR-code based customer ordering page
- Mobile-friendly digital menu
- Menu category browsing and item details
- Cart management and order submission
- Special request and dietary note input
- Basic multi-language menu support
- Staff-side order dashboard
- Real-time order status update
- Admin login
- Menu and category CRUD
- Item availability and sold-out status management
- Basic order history for restaurant staff
- Basic admin dashboard

The first version will focus on making the ordering flow complete and usable. Payment, advanced notifications, membership, refund management, and AI voice ordering will be added after the core ordering workflow is stable.

## 9. Future Improvements

Future versions of the system may include:

- Stripe payment integration and webhook-based payment status updates
- Real-time new order notifications for staff
- Customer order history and quick reorder
- Scheduled ordering for pickup or dining at a specific time
- Customer membership and loyalty rewards system
- Promotion and campaign management
- Push notifications or email notifications for new activities and offers
- Refund and issue-reporting workflow
- Advanced analytics dashboard for sales, popular items, and customer behaviour
- Inventory management and automatic stock updates
- Kitchen display system for order preparation
- AI-powered voice ordering
- AI-based menu recommendation system
- Multi-restaurant support
- Progressive Web App support
- Native mobile app support using React Native or Expo
- Microservice migration for AI, payment, notification, or order services
