using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PasswordManager.Api.Data;
using PasswordManager.Api.Models;

namespace PasswordManager.Api.Controllers;

[ApiController]
[Route("api/sections")]
public class SectionsController : ControllerBase
{
    private readonly AppDbContext _context;

    public SectionsController(AppDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var sections = await _context.Sections
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync();

        return Ok(sections);
    }

    [HttpPost]
    public async Task<IActionResult> Create(SectionItem item)
    {
        item.Id = string.IsNullOrWhiteSpace(item.Id) ? Guid.NewGuid().ToString() : item.Id;
        item.CreatedAt = DateTime.Now;
        item.UpdatedAt = DateTime.Now;
        item.Active = true;

        _context.Sections.Add(item);
        await _context.SaveChangesAsync();

        return Ok(item);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, SectionItem item)
    {
        var existing = await _context.Sections.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Name = item.Name;
        existing.Active = item.Active;
        existing.DeletedAt = item.DeletedAt;
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok(existing);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var existing = await _context.Sections.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Active = false;
        existing.DeletedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok();
    }
}