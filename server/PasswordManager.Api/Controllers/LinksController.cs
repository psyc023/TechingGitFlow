using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PasswordManager.Api.Data;
using PasswordManager.Api.Models;

namespace PasswordManager.Api.Controllers;

[ApiController]
[Route("api/links")]
public class LinksController : ControllerBase
{
    private readonly AppDbContext _context;

    public LinksController(AppDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var links = await _context.Links
            .Where(x => x.Active)
            .OrderByDescending(x => x.Id)
            .ToListAsync();

        return Ok(links);
    }

    [HttpPost]
    public async Task<IActionResult> Create(LinkItem item)
    {
        item.CreatedAt = DateTime.Now;
        item.UpdatedAt = DateTime.Now;
        item.Active = true;

        _context.Links.Add(item);

        await _context.SaveChangesAsync();

        return Ok(item);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, LinkItem item)
    {
        var existing = await _context.Links.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Title = item.Title;
        existing.Url = item.Url;
        existing.SectionId = item.SectionId;
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok(existing);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _context.Links.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Active = false;
        existing.DeletedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok();
    }
}