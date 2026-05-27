namespace PasswordManager.Api.Models;

public class PasswordItem
{
    public int Id { get; set; }
    public string Platform { get; set; } = "";
    public string PlatformUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public string Note { get; set; } = "";
    public string SectionId { get; set; } = "";
    public bool Active { get; set; } = true;
    public string DeletedAt { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}