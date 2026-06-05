using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RestaurantController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<RestaurantController> _logger;

    public RestaurantController(AppDbContext dbContext, ILogger<RestaurantController> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetRestaurants()
    {
        var restaurants = await _dbContext.Restaurants.ToListAsync();
        var responses = restaurants.Select(MapToResponse).ToList();
        return Ok(responses);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetRestaurant(Guid id)
    {
        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        return Ok(MapToResponse(restaurant));
    }

    [HttpPost]
    public async Task<IActionResult> CreateRestaurant([FromBody] RestaurantRequest request)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Restaurant data is required." });
        }

        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Address = request.Address,
            Phone = request.Phone,
            Timezone = request.Timezone,
            Currency = request.Currency,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = null
        };

        await _dbContext.Restaurants.AddAsync(restaurant);
        await _dbContext.SaveChangesAsync();

        var response = MapToResponse(restaurant);
        return CreatedAtAction(nameof(GetRestaurant), new { id = restaurant.Id }, response);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateRestaurant(Guid id, [FromBody] RestaurantRequest request)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Restaurant data is required." });
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        restaurant.Name = request.Name;
        restaurant.Address = request.Address;
        restaurant.Phone = request.Phone;
        restaurant.Timezone = request.Timezone;
        restaurant.Currency = request.Currency;
        restaurant.IsActive = request.IsActive;
        restaurant.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteRestaurant(Guid id)
    {
        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        _dbContext.Restaurants.Remove(restaurant);
        await _dbContext.SaveChangesAsync();

        return NoContent();
    }

    private static RestaurantResponse MapToResponse(Restaurant restaurant)
    {
        return new RestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        };
    }
}
