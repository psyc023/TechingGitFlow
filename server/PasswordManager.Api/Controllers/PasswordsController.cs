using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PasswordManager.Api.Data;
using PasswordManager.Api.Models;

namespace PasswordManager.Api.Controllers;

[ApiController]
[Route("api/passwords")]
public class PasswordsController : ControllerBase
{
    private readonly AppDbContext _context;

    public PasswordsController(AppDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var passwords = await _context.Passwords
            .Where(x => x.Active)
            .OrderByDescending(x => x.Id)
            .ToListAsync();

        return Ok(passwords);
    }

    [HttpPost]
    public async Task<IActionResult> Create(PasswordItem item)
    {
        item.CreatedAt = DateTime.Now;
        item.UpdatedAt = DateTime.Now;
        item.Active = true;

        _context.Passwords.Add(item);
        await _context.SaveChangesAsync();

        return Ok(item);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, PasswordItem item)
    {
        var existing = await _context.Passwords.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Platform = item.Platform;
        existing.PlatformUrl = item.PlatformUrl;
        existing.Username = item.Username;
        existing.Email = item.Email;
        existing.Password = item.Password;
        existing.SectionId = item.SectionId;
        existing.Note = item.Note;
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok(existing);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _context.Passwords.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Active = false;
        existing.DeletedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok();
    }
}