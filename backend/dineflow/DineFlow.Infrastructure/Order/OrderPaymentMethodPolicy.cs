using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Restaurant;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// Whether an order may still switch how it is going to be paid for.
/// </summary>
/// <remarks>
/// <para>
/// Choosing a payment method used to be reachable only through the cart that produced the order.
/// Once that cart was submitted — and its participant token gone from the browser — a customer had
/// no way back to the choice. If the restaurant had meanwhile turned Stripe off, "retry payment"
/// was refused and nothing offered the counter instead: an order that could not be paid and could
/// only be abandoned.
/// </para>
/// <para>
/// The rules live here so the cart route and the order route cannot drift into disagreeing about
/// what is allowed.
/// </para>
/// </remarks>
public static class OrderPaymentMethodPolicy
{
    /// <summary>Why a change was refused, or null when it is allowed.</summary>
    public static string? Refuse(Order order, PaymentMethod requested)
    {
        // Only an order that still owes money may choose how to settle. Testing for "not paid" was
        // not enough: a refunded or partially refunded order is not Paid either, and a successful
        // change resets the order to Unpaid — putting an order whose money has already been taken,
        // and partly given back, in front of the till as though nothing had ever been collected.
        // NotRequired is caught by the same rule, so a nothing-to-pay order is never made to owe.
        if (!OrderPaymentEligibility.IsPayableOnlineStatus(order.PaymentStatus))
        {
            return "The payment method cannot be changed after payment.";
        }

        // A live checkout session may be taking money at this very moment; switching underneath it
        // is how somebody pays for an order that has already been marked settled at the till.
        if (order.Payments.Any(payment => payment.Status == PaymentStatus.Pending))
        {
            return "The payment method cannot be changed while an online payment is pending.";
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return "This order is no longer open.";
        }

        return requested switch
        {
            PaymentMethod.PayAtCounter when !AllowsCounterPayment(order.Restaurant) =>
                "This restaurant requires online payment before the order can be processed.",
            PaymentMethod.Online when !AllowsOnlinePayment(order.Restaurant) =>
                "Online payment is not available for this restaurant yet. Please choose pay at counter.",
            _ => null,
        };
    }

    /// <summary>Whether the restaurant lets an order be settled at the till.</summary>
    public static bool AllowsCounterPayment(RestaurantEntity? restaurant) =>
        restaurant?.PaymentPolicy == RestaurantPaymentPolicy.PayAtCounterAllowed;

    /// <summary>Whether the restaurant can actually take a card right now.</summary>
    public static bool AllowsOnlinePayment(RestaurantEntity? restaurant) =>
        restaurant is not null
        && !string.IsNullOrWhiteSpace(restaurant.StripeAccountId)
        && restaurant.StripeChargesEnabled;
}
