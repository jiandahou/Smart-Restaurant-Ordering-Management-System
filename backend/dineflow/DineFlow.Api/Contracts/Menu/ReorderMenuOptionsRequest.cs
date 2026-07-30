namespace DineFlow.Api.Contracts.Menu;

public class ReorderMenuOptionGroupsRequest
{
    public List<Guid> GroupIds { get; set; } = [];
}

public class ReorderMenuOptionsRequest
{
    public List<Guid> OptionIds { get; set; } = [];
}
