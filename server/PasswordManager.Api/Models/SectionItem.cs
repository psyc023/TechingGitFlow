namespace PasswordManager.Api.Models;

public class SectionItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
    public string DeletedAt { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}