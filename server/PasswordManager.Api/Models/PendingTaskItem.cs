namespace PasswordManager.Api.Models;

public class PendingTaskItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString();

    public string Title { get; set; } = "";

    public string Company { get; set; } = "";

    public string Description { get; set; } = "";

    public string DueDate { get; set; } = "";

    public string Color { get; set; } = "green";

    public bool Active { get; set; } = true;

    public string DeletedAt { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.Now;

    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}