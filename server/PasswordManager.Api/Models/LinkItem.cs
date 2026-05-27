namespace PasswordManager.Api.Models;

public class LinkItem
{
    public int Id { get; set; }

    public string Title { get; set; } = "";

    public string Url { get; set; } = "";

    public string SectionId { get; set; } = "";

    public bool Active { get; set; } = true;

    public string DeletedAt { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.Now;

    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}